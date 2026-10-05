import type { Pool, PoolClient, Notification } from 'pg';
import { EXCHANGES, MESSAGE_HEADERS } from '@cip/contracts';
import { counter, extractTraceContext, gauge, SpanKind, withSpan, type Logger } from '@cip/observability';
import type { Publisher } from './publisher';

export interface OutboxRow {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  created_at: Date;
  attempts: number;
}

export interface OutboxRelayOptions {
  pool: Pool;
  publisher: Publisher;
  logger?: Logger;
  batchSize?: number;
  idleMs?: number;
  maxBackoffMs?: number;
  listen?: boolean;
  exchange?: string;
}

export function outboxEnvelope(row: OutboxRow) {
  return {
    event_id: row.id,
    event_type: row.event_type,
    schema_version: Number(row.headers?.schema_version ?? 1),
    tenant_id: row.tenant_id,
    occurred_at: new Date(row.created_at).toISOString(),
    properties: row.payload,
  };
}

export class OutboxRelay {
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private listener: PoolClient | null = null;
  private failures = 0;
  private readonly published = counter('outbox_published_total', 'Outbox rows published');
  private readonly failed = counter('outbox_publish_failures_total', 'Outbox publish failures');
  private readonly lag = gauge(
    'outbox_oldest_unpublished_seconds',
    'Age of the oldest unpublished outbox row',
  );

  constructor(private readonly options: OutboxRelayOptions) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.options.listen !== false) await this.listen().catch(() => undefined);
    this.loop = this.run();
  }

  private async listen(): Promise<void> {
    const client = await this.options.pool.connect();
    client.on('notification', (_n: Notification) => this.wake?.());
    client.on('error', () => {
      this.listener = null;
      client.release(true);
      if (this.running) setTimeout(() => void this.listen().catch(() => undefined), 1000).unref();
    });
    await client.query('LISTEN outbox');
    this.listener = client;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let published: number;
      let failed: number;
      try {
        const result = await this.runOnce();
        published = result.published;
        failed = result.failed;
      } catch (error) {
        published = 0;
        failed = 1;
        this.options.logger?.warn({ err: error }, 'outbox relay iteration failed');
      }
      if (!this.running) break;
      if (failed > 0) {
        this.failures += 1;
        const delay = Math.min(this.options.maxBackoffMs ?? 5000, 100 * 2 ** Math.min(this.failures, 6));
        await this.sleep(delay, false);
      } else {
        this.failures = 0;
        if (published === 0) await this.sleep(this.options.idleMs ?? 200, true);
      }
    }
  }

  private sleep(ms: number, wakeable: boolean): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      if (wakeable) {
        this.wake = () => {
          clearTimeout(timer);
          this.wake = null;
          resolve();
        };
      }
    });
  }

  async runOnce(): Promise<{ published: number; failed: number }> {
    const client = await this.options.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `select id, tenant_id, aggregate_type, aggregate_id, event_type, payload, headers, created_at, attempts
           from outbox where published_at is null
          order by created_at limit $1 for update skip locked`,
        [this.options.batchSize ?? 100],
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        this.lag.set(0);
        return { published: 0, failed: 0 };
      }
      this.lag.set((Date.now() - new Date(rows[0]!.created_at).getTime()) / 1000);
      const results = await Promise.all(
        rows.map(async (row) => {
          try {
            await withSpan(
              `publish ${row.event_type}`,
              {
                kind: SpanKind.PRODUCER,
                parent: extractTraceContext(row.headers),
                attributes: { 'cip.outbox_id': row.id },
              },
              () =>
                this.options.publisher.publish({
                  exchange: this.options.exchange ?? EXCHANGES.domain,
                  routingKey: row.event_type,
                  body: outboxEnvelope(row),
                  messageId: row.id,
                  timestamp: new Date(row.created_at).getTime(),
                  headers: {
                    [MESSAGE_HEADERS.tenantId]: row.tenant_id,
                    [MESSAGE_HEADERS.eventType]: row.event_type,
                    [MESSAGE_HEADERS.schemaVersion]: Number(row.headers?.schema_version ?? 1),
                    [MESSAGE_HEADERS.retryCount]: 0,
                  },
                }),
            );
            return { id: row.id, ok: true as const };
          } catch (error) {
            return { id: row.id, ok: false as const, error: (error as Error).message };
          }
        }),
      );
      const ok = results.filter((r) => r.ok).map((r) => r.id);
      const bad = results.filter((r) => !r.ok);
      if (ok.length > 0)
        await client.query('update outbox set published_at = now() where id = any($1::uuid[])', [ok]);
      for (const r of bad) {
        await client.query('update outbox set attempts = attempts + 1, last_error = $2 where id = $1', [
          r.id,
          r.ok ? null : r.error.slice(0, 1000),
        ]);
      }
      await client.query('COMMIT');
      this.published.inc(ok.length);
      if (bad.length > 0) {
        this.failed.inc(bad.length);
        this.options.logger?.warn(
          { failed: bad.length, error: bad[0] && !bad[0].ok ? bad[0].error : '' },
          'outbox publish failed',
        );
      }
      return { published: ok.length, failed: bad.length };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanup(olderThanDays = 7): Promise<number> {
    const result = await this.options.pool.query(
      `delete from outbox where published_at is not null and published_at < now() - make_interval(days => $1)`,
      [olderThanDays],
    );
    return result.rowCount ?? 0;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    if (this.listener) {
      await this.listener.query('UNLISTEN outbox').catch(() => undefined);
      this.listener.release();
      this.listener = null;
    }
  }
}
