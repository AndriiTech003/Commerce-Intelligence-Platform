import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { counter, type Logger } from '@cip/observability';
import { sql } from 'drizzle-orm';
import type { ApiConfig } from '../../../config';
import { fakePaymentWebhooks } from '../../../db/schema';
import { CONFIG, LOGGER } from '../../../shared/tokens';
import { TenantDatabase } from '../../tenancy';
import type { FakePaymentSimulator, FakeWebhookInput } from '../application/ports';
import { FAKE_SIGNATURE_HEADER, FakePaymentProvider } from './fake.provider';

const deliveries = counter('fake_payment_webhooks_total', 'Fake payment webhook delivery attempts', [
  'outcome',
]);

export const FAKE_WEBHOOK_MAX_ATTEMPTS = 6;
export const FAKE_WEBHOOK_LEASE_SECONDS = 15;

interface ClaimedWebhook {
  id: string;
  intent_id: string;
  body: string;
  attempts: number;
}

@Injectable()
export class FakeWebhookDispatcher implements FakePaymentSimulator, OnModuleInit, OnApplicationShutdown {
  private poller: NodeJS.Timeout | null = null;
  private readonly timers = new Set<NodeJS.Timeout>();
  private draining: Promise<number> | null = null;
  private stopped = false;

  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(TenantDatabase) private readonly db: TenantDatabase,
    @Inject(FakePaymentProvider) private readonly fake: FakePaymentProvider,
  ) {}

  onModuleInit(): void {
    if (this.config.PAYMENT_PROVIDER !== 'fake' || this.config.FAKE_PAYMENT_POLL_MS === 0) return;
    this.poller = setInterval(() => void this.deliverDue(), this.config.FAKE_PAYMENT_POLL_MS);
    this.poller.unref();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.poller) clearInterval(this.poller);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  async scheduleWebhook(event: FakeWebhookInput): Promise<{ id: string; dueInMs: number }> {
    const id = uuidv7();
    const dueInMs = this.config.FAKE_PAYMENT_DELAY_MS;
    await this.db
      .tx()
      .insert(fakePaymentWebhooks)
      .values({
        id,
        tenantId: event.tenantId,
        intentId: event.intentId,
        body: this.fake.buildWebhookBody(event),
        dueAt: sql`now() + ${dueInMs}::int * interval '1 millisecond'`,
      });
    return { id, dueInMs };
  }

  wake(id: string, dueInMs: number): void {
    if (this.stopped) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        void this.deliverOne(id);
      },
      Math.max(0, dueInMs) + 5,
    );
    timer.unref();
    this.timers.add(timer);
  }

  deliverDue(limit = 20): Promise<number> {
    if (this.stopped) return Promise.resolve(0);
    if (this.draining) return this.draining;
    this.draining = this.claim(null, limit)
      .then(async (rows) => {
        await Promise.all(rows.map((row) => this.send(row)));
        return rows.length;
      })
      .catch((error: unknown) => {
        this.logger.warn({ err: error }, 'fake webhook poll failed');
        return 0;
      })
      .finally(() => {
        this.draining = null;
      });
    return this.draining;
  }

  private async deliverOne(id: string): Promise<void> {
    if (this.stopped) return;
    try {
      const rows = await this.claim(id, 1);
      await Promise.all(rows.map((row) => this.send(row)));
    } catch (error) {
      this.logger.warn({ err: error, id }, 'fake webhook delivery failed');
    }
  }

  private async claim(id: string | null, limit: number): Promise<ClaimedWebhook[]> {
    const filter = id ? sql`and id = ${id}` : sql``;
    return this.db.withSystem(async (tx) => {
      const result = await tx.execute(sql`
        update fake_payment_webhooks
           set attempts = attempts + 1,
               due_at = now() + ${FAKE_WEBHOOK_LEASE_SECONDS}::int * interval '1 second'
         where id in (
           select id from fake_payment_webhooks
            where status = 'pending' and due_at <= now() ${filter}
            order by due_at
            limit ${limit}
            for update skip locked)
        returning id, intent_id, body, attempts`);
      return result.rows as unknown as ClaimedWebhook[];
    });
  }

  private async send(row: ClaimedWebhook): Promise<void> {
    const url = `${this.config.INTERNAL_API_URL.replace(/\/$/, '')}/v1/payments/webhooks/fake`;
    let status: number | null = null;
    let failure: string | null = null;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: this.fake.sign(row.body) },
        body: row.body,
        signal: AbortSignal.timeout(10000),
      });
      status = response.status;
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (status !== null && status < 300) {
      deliveries.inc({ outcome: 'delivered' });
      await this.finish(row.id, 'delivered', null);
      return;
    }
    const retryable = status === null || status >= 500 || status === 429;
    const error = failure ?? `HTTP ${status}`;
    if (!retryable || row.attempts >= FAKE_WEBHOOK_MAX_ATTEMPTS) {
      deliveries.inc({ outcome: 'failed' });
      this.logger.error({ intentId: row.intent_id, error, attempts: row.attempts }, 'fake webhook gave up');
      await this.finish(row.id, 'failed', error);
      return;
    }
    deliveries.inc({ outcome: 'retry' });
    const backoffMs = 500 * 2 ** (row.attempts - 1);
    await this.db.withSystem((tx) =>
      tx.execute(sql`
        update fake_payment_webhooks
           set due_at = now() + ${backoffMs}::int * interval '1 millisecond', last_error = ${error}::text
         where id = ${row.id} and status = 'pending'`),
    );
    this.wake(row.id, backoffMs);
  }

  private async finish(id: string, status: 'delivered' | 'failed', error: string | null): Promise<void> {
    await this.db.withSystem((tx) =>
      tx.execute(sql`
        update fake_payment_webhooks
           set status = ${status}::text,
               last_error = ${error}::text,
               delivered_at = case when ${status}::text = 'delivered' then now() else null end
         where id = ${id}`),
    );
  }
}
