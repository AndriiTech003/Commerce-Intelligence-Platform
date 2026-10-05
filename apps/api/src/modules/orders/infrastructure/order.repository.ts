import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { uuidv7, type OrderStatus } from '@cip/contracts';
import { orderItems, orders, orderStatusHistory, payments, tenantCounters } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { Order, OrderItem } from '../domain/order';
import type { OrderListQuery, OrderRepository } from '../application/ports';

function toOrder(row: typeof orders.$inferSelect): Order {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    email: row.email,
    status: row.status as OrderStatus,
    currency: row.currency,
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    shippingCents: row.shippingCents,
    totalCents: row.totalCents,
    discountCode: row.discountCode,
    shippingAddress: row.shippingAddress,
    idempotencyKey: row.idempotencyKey,
    attribution: row.attribution ?? null,
    profileId: row.profileId,
    placedAt: row.placedAt,
  };
}

@Injectable()
export class DrizzleOrderRepository implements OrderRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async nextNumber() {
    const [row] = await this.db
      .tx()
      .insert(tenantCounters)
      .values({ tenantId: this.db.tenantId(), name: 'order_number', value: 1001 })
      .onConflictDoUpdate({
        target: [tenantCounters.tenantId, tenantCounters.name],
        set: { value: sql`${tenantCounters.value} + 1` },
      })
      .returning({ value: tenantCounters.value });
    return row!.value;
  }

  async insert(order: Order, items: OrderItem[]) {
    const tenantId = this.db.tenantId();
    await this.db
      .tx()
      .insert(orders)
      .values({ ...order, tenantId });
    if (items.length > 0) {
      await this.db
        .tx()
        .insert(orderItems)
        .values(
          items.map((i) => ({
            id: i.id,
            tenantId,
            orderId: order.id,
            variantId: i.variantId,
            productId: i.productId,
            titleSnapshot: i.title,
            skuSnapshot: i.sku,
            unitPriceCents: i.unitPriceCents,
            quantity: i.quantity,
          })),
        );
    }
  }

  async find(id: string) {
    const [row] = await this.db.tx().select().from(orders).where(eq(orders.id, id)).limit(1);
    return row ? toOrder(row) : null;
  }

  async findForUpdate(id: string) {
    const [row] = await this.db.tx().select().from(orders).where(eq(orders.id, id)).limit(1).for('update');
    return row ? toOrder(row) : null;
  }

  async findByIdempotencyKey(key: string) {
    const [row] = await this.db.tx().select().from(orders).where(eq(orders.idempotencyKey, key)).limit(1);
    return row ? toOrder(row) : null;
  }

  async items(orderId: string): Promise<OrderItem[]> {
    const rows = await this.db
      .tx()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id));
    return rows.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      productId: r.productId,
      title: r.titleSnapshot,
      sku: r.skuSnapshot,
      unitPriceCents: r.unitPriceCents,
      quantity: r.quantity,
    }));
  }

  async itemsCount(orderIds: string[]) {
    const map = new Map<string, number>();
    if (orderIds.length === 0) return map;
    const rows = await this.db
      .tx()
      .select({ orderId: orderItems.orderId, n: sql<number>`sum(${orderItems.quantity})::int` })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .groupBy(orderItems.orderId);
    for (const r of rows) map.set(r.orderId, Number(r.n));
    return map;
  }

  async history(orderId: string) {
    return this.db
      .tx()
      .select({
        id: orderStatusHistory.id,
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        reason: orderStatusHistory.reason,
        actorId: orderStatusHistory.actorId,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.createdAt), asc(orderStatusHistory.id));
  }

  async payments(orderId: string) {
    return this.db
      .tx()
      .select({
        id: payments.id,
        provider: payments.provider,
        providerRef: payments.providerRef,
        clientSecret: payments.clientSecret,
        status: payments.status,
        amountCents: payments.amountCents,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(asc(payments.createdAt));
  }

  async setStatus(orderId: string, status: OrderStatus) {
    await this.db.tx().update(orders).set({ status }).where(eq(orders.id, orderId));
  }

  async addHistory(
    orderId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    reason: string | null,
    actorId: string | null,
  ) {
    await this.db.tx().insert(orderStatusHistory).values({
      id: uuidv7(),
      tenantId: this.db.tenantId(),
      orderId,
      fromStatus: from,
      toStatus: to,
      reason,
      actorId,
    });
  }

  async list(query: OrderListQuery) {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(orders.status, query.status));
    if (query.from) conditions.push(gte(orders.placedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(orders.placedAt, new Date(query.to)));
    if (query.customerId) conditions.push(eq(orders.customerId, query.customerId));
    if (query.email) conditions.push(sql`${orders.email} ilike ${`%${query.email}%`}`);
    if (query.number !== undefined) conditions.push(eq(orders.number, query.number));
    if (query.minTotal !== undefined) conditions.push(gte(orders.totalCents, query.minTotal));
    if (query.maxTotal !== undefined) conditions.push(lte(orders.totalCents, query.maxTotal));
    if (query.cursor) {
      conditions.push(
        sql`(${orders.placedAt}, ${orders.id}) < (${String(query.cursor.v)}::timestamptz, ${query.cursor.id}::uuid)`,
      );
    }
    const rows = await this.db
      .tx()
      .select()
      .from(orders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(query.limit);
    return rows.map(toOrder);
  }

  async listForCustomer(customerId: string, limit: number) {
    const rows = await this.db
      .tx()
      .select()
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.placedAt))
      .limit(limit);
    return rows.map(toOrder);
  }

  async categoryPaths(productIds: string[]) {
    const map = new Map<string, string>();
    if (productIds.length === 0) return map;
    const result = await this.db.tx().execute(sql`
      select p.id, coalesce(c.path::text, '') as path from products p left join categories c on c.id = p.category_id
      where p.id in (${sql.join(
        productIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`);
    for (const r of result.rows as Array<{ id: string; path: string }>) map.set(r.id, r.path);
    return map;
  }
}
