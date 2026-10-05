import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { parseDomainEvent, WEBHOOK_EVENTS, type DomainEvent } from '@cip/contracts';
import { PoisonMessageError } from '@cip/messaging';
import { counter, histogram, type Logger } from '@cip/observability';
import type { MailTransport } from './notifications/handler';

const deliveries = counter('webhook_deliveries_total', 'Outgoing merchant webhook attempts', ['outcome']);
const deliverySeconds = histogram('webhook_delivery_seconds', 'Outgoing webhook request duration');

export function signPayload(secret: string, timestamp: number, body: string): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export function verifySignature(
  secret: string,
  header: string,
  body: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (options.toleranceSeconds ?? 300)) return false;
  return signPayload(secret, t, body) === header;
}

export function parseWebhookEvent(raw: unknown): DomainEvent {
  const parsed = parseDomainEvent(raw);
  if (!parsed.ok) throw new PoisonMessageError(parsed.reason);
  return parsed.event;
}

interface DeliveryRow {
  id: string;
  tenant_id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  url: string;
  secret: string;
  endpoint_status: string;
}

export interface WebhookOptions {
  scheduleSeconds: number[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class WebhookDispatcher {
  constructor(
    private readonly pool: Pool,
    private readonly mail: MailTransport,
    private readonly logger: Logger,
    private readonly options: WebhookOptions,
  ) {}

  async enqueue(event: DomainEvent): Promise<string[]> {
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(event.event_type)) return [];
    const payload = {
      id: event.event_id,
      type: event.event_type,
      created_at: event.occurred_at,
      data: event.properties,
    };
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into webhook_deliveries (id, tenant_id, endpoint_id, event_id, event_type, payload, status, next_attempt_at)
       select gen_random_uuid(), e.tenant_id, e.id, $2, $3, $4::jsonb, 'pending', now() + interval '2 minutes'
         from webhook_endpoints e
        where e.tenant_id = $1 and e.status = 'active' and $3 = any(e.events)
       on conflict (endpoint_id, event_id) do nothing
       returning id`,
      [event.tenant_id, event.event_id, event.event_type, JSON.stringify(payload)],
    );
    const ids = rows.map((r) => r.id);
    for (const id of ids)
      await this.deliver(id).catch((error: unknown) => this.logger.warn({ err: error }, 'delivery failed'));
    return ids;
  }

  async deliverDue(limit = 20): Promise<number> {
    const client = await this.pool.connect();
    let ids: string[];
    try {
      await client.query('begin');
      const { rows } = await client.query<{ id: string }>(
        `select id from webhook_deliveries
          where status in ('pending', 'failed') and next_attempt_at <= now()
          order by next_attempt_at limit $1 for update skip locked`,
        [limit],
      );
      ids = rows.map((r) => r.id);
      if (ids.length > 0)
        await client.query(
          `update webhook_deliveries set next_attempt_at = now() + interval '2 minutes' where id = any($1::uuid[])`,
          [ids],
        );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    for (const id of ids)
      await this.deliver(id).catch((error: unknown) => this.logger.warn({ err: error }, 'delivery failed'));
    return ids.length;
  }

  async deliver(deliveryId: string): Promise<'succeeded' | 'failed' | 'dead' | 'skipped'> {
    const { rows } = await this.pool.query<DeliveryRow>(
      `select d.id, d.tenant_id, d.endpoint_id, d.event_id, d.event_type, d.payload, d.attempts,
              e.url, e.secret, e.status as endpoint_status
         from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
        where d.id = $1 and d.status in ('pending', 'failed')`,
      [deliveryId],
    );
    const row = rows[0];
    if (!row) return 'skipped';
    if (row.endpoint_status !== 'active') {
      await this.pool.query(
        `update webhook_deliveries set status = 'dead', last_error = 'endpoint disabled' where id = $1`,
        [row.id],
      );
      return 'dead';
    }
    const body = JSON.stringify(row.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const started = Date.now();
    let status: number | null = null;
    let error: string | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const stopTimer = deliverySeconds.startTimer();
    try {
      const response = await (this.options.fetchImpl ?? fetch)(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'cip-webhooks/1.0',
          'x-webhook-id': row.event_id,
          'x-webhook-event': row.event_type,
          'x-webhook-delivery': row.id,
          'x-signature': signPayload(row.secret, timestamp, body),
        },
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
      status = response.status;
      await response.arrayBuffer().catch(() => undefined);
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      clearTimeout(timer);
      stopTimer();
    }
    const duration = Date.now() - started;
    const attempts = row.attempts + 1;
    if (!error) {
      await this.pool.query(
        `update webhook_deliveries set status = 'succeeded', attempts = $2, last_status_code = $3, last_error = null,
            duration_ms = $4, delivered_at = now(), next_attempt_at = null where id = $1`,
        [row.id, attempts, status, duration],
      );
      deliveries.inc({ outcome: 'succeeded' });
      return 'succeeded';
    }
    const retryIndex = attempts - 1;
    if (retryIndex < this.options.scheduleSeconds.length) {
      await this.pool.query(
        `update webhook_deliveries set status = 'failed', attempts = $2, last_status_code = $3, last_error = $4,
            duration_ms = $5, next_attempt_at = now() + make_interval(secs => $6) where id = $1`,
        [row.id, attempts, status, error.slice(0, 500), duration, this.options.scheduleSeconds[retryIndex]],
      );
      deliveries.inc({ outcome: 'retry' });
      return 'failed';
    }
    await this.pool.query(
      `update webhook_deliveries set status = 'dead', attempts = $2, last_status_code = $3, last_error = $4,
          duration_ms = $5, next_attempt_at = null where id = $1`,
      [row.id, attempts, status, error.slice(0, 500), duration],
    );
    await this.disableEndpoint(row);
    deliveries.inc({ outcome: 'dead' });
    return 'dead';
  }

  private async disableEndpoint(row: DeliveryRow): Promise<void> {
    const { rowCount } = await this.pool.query(
      `update webhook_endpoints set status = 'disabled', disabled_at = now() where id = $1 and status = 'active'`,
      [row.endpoint_id],
    );
    if (!rowCount) return;
    const owners = await this.pool.query<{ email: string; name: string }>(
      `select u.email, t.name from memberships m join users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
        where m.tenant_id = $1 and m.role in ('owner', 'admin')`,
      [row.tenant_id],
    );
    for (const owner of owners.rows) {
      await this.mail
        .send({
          to: owner.email,
          subject: `[${owner.name}] Webhook endpoint disabled after repeated failures`,
          text: `Deliveries to ${row.url} failed ${this.options.scheduleSeconds.length + 1} times in a row (last event ${row.event_type} ${row.event_id}).\nThe endpoint was disabled. Fix the receiver, re-enable it in Settings → Webhooks and use Resend for the failed deliveries.\nReference: ${randomUUID()}`,
        })
        .catch((error: unknown) => this.logger.warn({ err: error }, 'webhook disable email failed'));
    }
    this.logger.warn({ endpointId: row.endpoint_id, url: row.url }, 'webhook endpoint disabled');
  }
}
