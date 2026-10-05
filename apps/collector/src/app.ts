import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  collectBatchSchema,
  EXCHANGES,
  incomingTrackEventSchema,
  MESSAGE_HEADERS,
  parseTrackEvent,
  SERVER_ONLY_TRACK_EVENTS,
} from '@cip/contracts';
import type { OutgoingMessage } from '@cip/messaging';
import {
  counter,
  currentTraceparent,
  extractTraceContext,
  histogram,
  metricsText,
  runHealthChecks,
  SpanKind,
  withSpan,
  type Logger,
} from '@cip/observability';
import type { PublishBuffer } from './buffer';
import { enrich } from './enrich';
import type { KeyResolver } from './keys';
import type { RateLimitDecision } from './rate-limit';

export interface CollectorDeps {
  buffer: PublishBuffer;
  keys: KeyResolver;
  limit: (subject: string, cost: number, kind: 'key' | 'ip') => Promise<RateLimitDecision>;
  ready: () => boolean;
  logger: Logger;
  maxEvents: number;
  maxBodyBytes: number;
}

const events = counter('collector_events_total', 'Events received by the collector', ['outcome']);
const eventsByType = counter('collector_events_by_type_total', 'Accepted events by event type', [
  'event_type',
]);
const requests = histogram('collector_request_duration_seconds', 'Collector request duration', ['status']);

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function buildCollector(deps: CollectorDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: deps.maxBodyBytes, trustProxy: true });
  await app.register(cors, {
    origin: true,
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-api-key', 'traceparent'],
    exposedHeaders: ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  });
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    const result = await runHealthChecks({
      rabbitmq: () => {
        if (!deps.ready()) throw new Error('disconnected');
      },
    });
    reply.code(result.ok ? 200 : 503);
    return { status: result.ok ? 'ok' : 'unavailable', checks: result.checks, buffered: deps.buffer.length };
  });
  app.get('/metrics', async (_req, reply) => {
    const { contentType, body } = await metricsText();
    reply.header('content-type', contentType);
    return body;
  });

  app.post('/v1/events', async (req, reply) => {
    const started = process.hrtime.bigint();
    const respond = (status: number, body: unknown) => {
      requests.observe({ status: String(status) }, Number(process.hrtime.bigint() - started) / 1e9);
      return reply.code(status).send(body);
    };
    return withSpan(
      'POST /v1/events',
      { kind: SpanKind.SERVER, parent: extractTraceContext(req.headers as Record<string, unknown>) },
      async () => {
        const rawKey =
          firstHeader(req.headers['x-api-key']) ?? (req.query as Record<string, string | undefined>).key;
        if (!rawKey) return respond(401, { code: 'UNAUTHORIZED', detail: 'Missing publishable key' });
        const key = await deps.keys.resolve(rawKey);
        if (!key) return respond(401, { code: 'UNAUTHORIZED', detail: 'Invalid publishable key' });
        const batch = collectBatchSchema.safeParse(req.body);
        if (!batch.success) {
          return respond(400, {
            code: 'VALIDATION_FAILED',
            detail: batch.error.issues[0]?.message ?? 'invalid batch',
          });
        }
        if (batch.data.events.length > deps.maxEvents) {
          return respond(400, {
            code: 'VALIDATION_FAILED',
            detail: `At most ${deps.maxEvents} events per batch`,
          });
        }
        const cost = batch.data.events.length;
        for (const [kind, subject] of [
          ['key', key.id],
          ['ip', req.ip],
        ] as const) {
          const decision = await deps.limit(subject, cost, kind);
          reply.header('RateLimit-Limit', String(decision.limit));
          reply.header('RateLimit-Remaining', String(decision.remaining));
          reply.header('RateLimit-Reset', String(Math.ceil(decision.resetMs / 1000)));
          if (!decision.allowed) {
            events.inc({ outcome: 'rate_limited' }, cost);
            reply.header('Retry-After', String(Math.max(1, Math.ceil(decision.resetMs / 1000))));
            return respond(429, { code: 'RATE_LIMITED', detail: 'Too many events' });
          }
        }
        const receivedAt = new Date().toISOString();
        const userAgent = firstHeader(req.headers['user-agent']);
        const rejected: Array<{ index: number; reason: string }> = [];
        const messages: OutgoingMessage[] = [];
        const traceparent = currentTraceparent();
        batch.data.events.forEach((raw, index) => {
          const shape = incomingTrackEventSchema.safeParse(raw);
          if (!shape.success) {
            const issue = shape.error.issues[0];
            rejected.push({
              index,
              reason: issue ? `${issue.path.join('.') || 'event'}: ${issue.message}` : 'invalid',
            });
            return;
          }
          const enriched = enrich(shape.data, { tenantId: key.tenantId, ip: req.ip, userAgent, receivedAt });
          if ((SERVER_ONLY_TRACK_EVENTS as readonly string[]).includes(shape.data.event_type)) {
            rejected.push({ index, reason: 'server-only event_type' });
            return;
          }
          const parsed = parseTrackEvent(enriched);
          if (!parsed.ok) {
            rejected.push({ index, reason: parsed.reason });
            return;
          }
          messages.push({
            exchange: EXCHANGES.track,
            routingKey: parsed.event.event_type,
            body: parsed.event,
            messageId: parsed.event.event_id,
            headers: {
              [MESSAGE_HEADERS.tenantId]: key.tenantId,
              [MESSAGE_HEADERS.eventType]: parsed.event.event_type,
              [MESSAGE_HEADERS.schemaVersion]: parsed.event.schema_version,
              [MESSAGE_HEADERS.retryCount]: 0,
              ...(traceparent ? { traceparent } : {}),
            },
          });
        });
        const outcome = await deps.buffer.submit(messages);
        if (outcome === 'overflow') {
          events.inc({ outcome: 'overflow' }, messages.length);
          reply.header('Retry-After', '5');
          return respond(503, { code: 'SERVICE_UNAVAILABLE', detail: 'Event buffer is full, retry later' });
        }
        events.inc({ outcome }, messages.length);
        events.inc({ outcome: 'rejected' }, rejected.length);
        for (const message of messages) eventsByType.inc({ event_type: message.routingKey });
        return respond(202, { accepted: messages.length, rejected });
      },
    );
  });
  return app;
}
