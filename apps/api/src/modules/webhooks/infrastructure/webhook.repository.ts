import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { webhookDeliveries, webhookEndpoints } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { WebhookDelivery, WebhookEndpoint, WebhookRepository } from '../application/ports';

function toEndpoint(row: typeof webhookEndpoints.$inferSelect, last: Date | null = null): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    secret: row.secret,
    secretPrefix: row.secretPrefix,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    description: row.description,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
    lastDeliveryAt: last,
  };
}

function toDelivery(row: typeof webhookDeliveries.$inferSelect): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status as WebhookDelivery['status'],
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    payload: row.payload,
  };
}

@Injectable()
export class DrizzleWebhookRepository implements WebhookRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async list() {
    const rows = await this.db.tx().select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt));
    const last = await this.db
      .tx()
      .execute(sql`select endpoint_id, max(created_at) as last from webhook_deliveries group by endpoint_id`);
    const map = new Map(
      (last.rows as Array<{ endpoint_id: string; last: string }>).map((r) => [
        r.endpoint_id,
        new Date(r.last),
      ]),
    );
    return rows.map((r) => toEndpoint(r, map.get(r.id) ?? null));
  }

  async find(id: string) {
    const [row] = await this.db
      .tx()
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    return row ? toEndpoint(row) : null;
  }

  async insert(endpoint: Omit<WebhookEndpoint, 'createdAt' | 'disabledAt' | 'lastDeliveryAt'>) {
    const [row] = await this.db
      .tx()
      .insert(webhookEndpoints)
      .values({ ...endpoint, tenantId: this.db.tenantId() })
      .returning();
    return toEndpoint(row!);
  }

  async update(
    id: string,
    patch: Partial<Pick<WebhookEndpoint, 'url' | 'events' | 'status' | 'description' | 'disabledAt'>>,
  ) {
    if (Object.keys(patch).length === 0) return this.find(id);
    const [row] = await this.db
      .tx()
      .update(webhookEndpoints)
      .set(patch)
      .where(eq(webhookEndpoints.id, id))
      .returning();
    return row ? toEndpoint(row) : null;
  }

  async remove(id: string) {
    const rows = await this.db
      .tx()
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .returning({ id: webhookEndpoints.id });
    return rows.length > 0;
  }

  async deliveries(endpointId: string, limit: number) {
    return (
      await this.db
        .tx()
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, endpointId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit)
    ).map(toDelivery);
  }

  async findDelivery(id: string) {
    const [row] = await this.db
      .tx()
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id))
      .limit(1);
    return row ? toDelivery(row) : null;
  }

  async resend(id: string) {
    const [row] = await this.db
      .tx()
      .update(webhookDeliveries)
      .set({ status: 'pending', nextAttemptAt: new Date(), attempts: 0, lastError: null })
      .where(eq(webhookDeliveries.id, id))
      .returning();
    return row ? toDelivery(row) : null;
  }
}
