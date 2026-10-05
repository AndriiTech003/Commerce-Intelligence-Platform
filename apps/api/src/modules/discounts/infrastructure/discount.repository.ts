import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { discounts } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { Discount } from '../domain/discount';
import type { DiscountRepository, DiscountWrite } from '../application/ports';

function toDiscount(row: typeof discounts.$inferSelect): Discount {
  return {
    id: row.id,
    code: row.code,
    type: row.type === 'fixed' ? 'fixed' : 'percent',
    value: row.value,
    minSubtotalCents: row.minSubtotalCents,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    usedCount: row.usedCount,
    active: row.active,
  };
}

@Injectable()
export class DrizzleDiscountRepository implements DiscountRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async list() {
    return (await this.db.tx().select().from(discounts).orderBy(desc(discounts.id))).map(toDiscount);
  }

  async find(id: string) {
    const [row] = await this.db.tx().select().from(discounts).where(eq(discounts.id, id)).limit(1);
    return row ? toDiscount(row) : null;
  }

  async findByCode(code: string) {
    const [row] = await this.db.tx().select().from(discounts).where(eq(discounts.code, code)).limit(1);
    return row ? toDiscount(row) : null;
  }

  async insert(id: string, discount: DiscountWrite) {
    const [row] = await this.db
      .tx()
      .insert(discounts)
      .values({ id, tenantId: this.db.tenantId(), ...discount })
      .returning();
    return toDiscount(row!);
  }

  async update(id: string, patch: Partial<DiscountWrite>) {
    if (Object.keys(patch).length === 0) return this.find(id);
    const [row] = await this.db.tx().update(discounts).set(patch).where(eq(discounts.id, id)).returning();
    return row ? toDiscount(row) : null;
  }

  async remove(id: string) {
    const rows = await this.db
      .tx()
      .delete(discounts)
      .where(eq(discounts.id, id))
      .returning({ id: discounts.id });
    return rows.length > 0;
  }

  async incrementUsage(id: string) {
    const rows = await this.db
      .tx()
      .update(discounts)
      .set({ usedCount: sql`${discounts.usedCount} + 1` })
      .where(
        and(
          eq(discounts.id, id),
          or(isNull(discounts.usageLimit), lt(discounts.usedCount, discounts.usageLimit)),
        ),
      )
      .returning({ id: discounts.id });
    return rows.length > 0;
  }

  async decrementUsage(id: string) {
    await this.db
      .tx()
      .update(discounts)
      .set({ usedCount: sql`greatest(${discounts.usedCount} - 1, 0)` })
      .where(eq(discounts.id, id));
  }

  async customerUses(code: string, email: string | null, customerId: string | null) {
    const result = await this.db.tx().execute(sql`
      select count(*)::int as n from orders
      where upper(discount_code) = upper(${code})
        and status not in ('cancelled', 'payment_failed')
        and (${customerId}::uuid is not null and customer_id = ${customerId}::uuid or ${email}::text is not null and email = ${email}::citext)`);
    return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
  }
}
