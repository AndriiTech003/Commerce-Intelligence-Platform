import type { Channel, ConsumeMessage } from 'amqplib';
import { MESSAGE_HEADERS, queueName, RETRY_DELAYS, type RetryDelay } from '@cip/contracts';
import { counter, extractTraceContext, histogram, SpanKind, withSpan, type Logger } from '@cip/observability';
import type { AmqpClient } from './connection';
import type { Deduper } from './dedupe';
import { defaultClassifyError, PoisonMessageError, type ErrorKind } from './errors';
import { messageIdOf, retryCountOf, routeFailure } from './failure';
import type { Publisher } from './publisher';

export interface MessageContext {
  messageId: string;
  routingKey: string;
  exchange: string;
  retryCount: number;
  headers: Record<string, unknown>;
  redelivered: boolean;
}

export interface ConsumeOptions<T> {
  queue: string;
  consumer: string;
  prefetch: number;
  parse?: (raw: unknown) => T;
  handler: (message: T, ctx: MessageContext) => Promise<void>;
  retry?: { delays: readonly RetryDelay[] };
  classifyError?: (error: unknown) => ErrorKind;
  idempotency?: { deduper: Deduper; mode?: 'after' | 'claim' } | null;
  occurredAt?: (message: T) => string | undefined;
}

export const consumerMetrics = () => ({
  consumed: counter('messages_consumed_total', 'Messages consumed', ['queue', 'outcome']),
  processing: histogram('message_processing_seconds', 'Message processing time', ['queue']),
  endToEnd: histogram(
    'message_end_to_end_seconds',
    'Time from occurred_at to processed',
    ['queue'],
    [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300],
  ),
  duplicates: counter('messages_duplicate_total', 'Duplicate messages skipped', ['queue']),
});

export function decodeJson(message: ConsumeMessage): unknown {
  try {
    return JSON.parse(message.content.toString('utf8'));
  } catch {
    throw new PoisonMessageError('message body is not valid JSON');
  }
}

export function contextOf(message: ConsumeMessage): MessageContext {
  return {
    messageId: messageIdOf(message),
    routingKey: message.fields.routingKey,
    exchange: message.fields.exchange,
    retryCount: retryCountOf(message),
    headers: { ...(message.properties.headers ?? {}) },
    redelivered: message.fields.redelivered,
  };
}

export function observeEndToEnd(queue: string, occurredAt: string | undefined): void {
  if (!occurredAt) return;
  const ts = Date.parse(occurredAt);
  if (Number.isFinite(ts))
    consumerMetrics().endToEnd.observe({ queue }, Math.max(0, (Date.now() - ts) / 1000));
}

function defaultOccurredAt(value: unknown): string | undefined {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { occurred_at?: unknown }).occurred_at === 'string'
  ) {
    return (value as { occurred_at: string }).occurred_at;
  }
  return undefined;
}

export class Consumer<T> {
  private channel: Channel | null = null;
  private consumerTag: string | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly inFlightIds = new Map<string, Promise<void>>();
  private stopping = false;
  private readonly metrics = consumerMetrics();

  constructor(
    private readonly client: AmqpClient,
    private readonly publisher: Publisher,
    private readonly options: ConsumeOptions<T>,
    private readonly logger?: Logger,
  ) {}

  start(): void {
    this.client.onConnect(async (model) => {
      if (this.stopping) return;
      const channel = await model.createChannel();
      channel.on('error', (error: Error) => this.logger?.warn({ err: error }, 'consumer channel error'));
      channel.on('close', () => {
        if (this.channel === channel) {
          this.channel = null;
          this.consumerTag = null;
        }
      });
      await channel.checkQueue(queueName(this.options.queue));
      await channel.prefetch(this.options.prefetch);
      const reply = await channel.consume(queueName(this.options.queue), (message) => {
        if (!message) return;
        const id = messageIdOf(message);
        const previous = this.inFlightIds.get(id);
        const task = (
          previous
            ? previous.catch(() => undefined).then(() => this.handle(channel, message))
            : this.handle(channel, message)
        ).finally(() => {
          this.inFlight.delete(task);
          if (this.inFlightIds.get(id) === task) this.inFlightIds.delete(id);
        });
        this.inFlight.add(task);
        this.inFlightIds.set(id, task);
      });
      this.channel = channel;
      this.consumerTag = reply.consumerTag;
    });
  }

  private async handle(channel: Channel, message: ConsumeMessage): Promise<void> {
    const queue = queueName(this.options.queue);
    const ctx = contextOf(message);
    const parent = extractTraceContext(ctx.headers);
    const timer = this.metrics.processing.startTimer({ queue });
    await withSpan(
      `consume ${queue}`,
      {
        kind: SpanKind.CONSUMER,
        parent,
        attributes: {
          'messaging.system': 'rabbitmq',
          'messaging.destination.name': queue,
          'messaging.message.id': ctx.messageId,
          'messaging.rabbitmq.destination.routing_key': ctx.routingKey,
          'cip.retry_count': ctx.retryCount,
        },
      },
      async (span) => {
        let parsed: T;
        try {
          const raw = decodeJson(message);
          parsed = this.options.parse ? this.options.parse(raw) : (raw as T);
        } catch (error) {
          await this.fail(channel, message, 'poison', error);
          return;
        }
        const idem = this.options.idempotency;
        try {
          if (idem) {
            const duplicate =
              idem.mode === 'claim'
                ? !(await idem.deduper.claim(this.options.consumer, ctx.messageId))
                : await idem.deduper.isProcessed(this.options.consumer, ctx.messageId);
            if (duplicate) {
              span.setAttribute('cip.duplicate', true);
              this.metrics.duplicates.inc({ queue });
              this.metrics.consumed.inc({ queue, outcome: 'duplicate' });
              channel.ack(message);
              return;
            }
          }
          await this.options.handler(parsed, ctx);
          if (idem && idem.mode !== 'claim')
            await idem.deduper.markProcessed(this.options.consumer, ctx.messageId);
          channel.ack(message);
          this.metrics.consumed.inc({ queue, outcome: 'ack' });
          observeEndToEnd(queue, (this.options.occurredAt ?? defaultOccurredAt)(parsed as never));
        } catch (error) {
          const kind = (this.options.classifyError ?? defaultClassifyError)(error);
          await this.fail(channel, message, kind, error);
        }
      },
    ).finally(() => timer());
  }

  private async fail(
    channel: Channel,
    message: ConsumeMessage,
    kind: ErrorKind,
    error: unknown,
  ): Promise<void> {
    const queue = queueName(this.options.queue);
    try {
      const outcome = await routeFailure(
        this.publisher,
        message,
        this.options.queue,
        kind,
        error,
        this.options.retry?.delays ?? RETRY_DELAYS,
      );
      channel.ack(message);
      this.metrics.consumed.inc({ queue, outcome });
      this.logger?.warn(
        {
          err: error,
          queue,
          messageId: messageIdOf(message),
          outcome,
          kind,
          retryCount: retryCountOf(message),
        },
        'message failed',
      );
    } catch (publishError) {
      this.logger?.error({ err: publishError, queue }, 'could not route failed message, requeueing');
      try {
        channel.nack(message, false, true);
      } catch {
        return;
      }
    }
  }

  async stop(timeoutMs = 25000): Promise<void> {
    this.stopping = true;
    const channel = this.channel;
    if (channel && this.consumerTag) await channel.cancel(this.consumerTag).catch(() => undefined);
    const pending = Promise.allSettled([...this.inFlight]);
    await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]);
    if (channel) await channel.close().catch(() => undefined);
    this.channel = null;
  }
}

export { MESSAGE_HEADERS };
