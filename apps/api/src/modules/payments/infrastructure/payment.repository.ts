import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { payments, paymentWebhookEvents } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { PaymentStatus } from '../domain/payment';
import type { PaymentRecord, PaymentRepository } from '../application/ports';

function toRecord(row: typeof payments.$inferSelect): PaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    providerRef: row.providerRef,
    clientSecret: row.clientSecret,
    status: row.status as PaymentStatus,
    amountCents: row.amountCents,
  };
}

@Injectable()
export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async insert(record: PaymentRecord) {
    await this.db
      .tx()
      .insert(payments)
      .values({ ...record, tenantId: this.db.tenantId() });
  }

  async findByRef(provider: string, ref: string, forUpdate: boolean) {
    const query = this.db
      .tx()
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerRef, ref)))
      .limit(1);
    const [row] = forUpdate ? await query.for('update') : await query;
    return row ? toRecord(row) : null;
  }

  async findLatestForOrder(orderId: string) {
    const [row] = await this.db
      .tx()
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async setStatus(id: string, status: PaymentStatus) {
    await this.db.tx().update(payments).set({ status }).where(eq(payments.id, id));
  }

  async recordWebhook(provider: string, eventId: string) {
    const rows = await this.db
      .tx()
      .insert(paymentWebhookEvents)
      .values({ provider, providerEventId: eventId })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEvents.providerEventId });
    return rows.length > 0;
  }

  async markWebhookProcessed(provider: string, eventId: string) {
    await this.db
      .tx()
      .update(paymentWebhookEvents)
      .set({ processedAt: new Date() })
      .where(
        and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.providerEventId, eventId)),
      );
  }
}
