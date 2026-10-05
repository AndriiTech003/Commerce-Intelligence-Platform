import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDatabase } from '../../tenancy';
import type { CustomerQueries, CustomerSummaryRow } from '../application/ports';

function toRow(r: Record<string, unknown>): CustomerSummaryRow {
  return {
    id: String(r.id),
    email: String(r.email),
    name: (r.name as string | null) ?? null,
    registered: Boolean(r.registered),
    ordersCount: Number(r.orders_count ?? 0),
    ltvCents: Number(r.ltv_cents ?? 0),
    createdAt: new Date(String(r.created_at)),
    anonymousIds: (r.anonymous_ids as string[] | null) ?? [],
  };
}

@Injectable()
export class DrizzleCustomerQueries implements CustomerQueries {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  private select(where: ReturnType<typeof sql>, limit: number) {
    return sql`
      select c.id, c.email, c.name, c.password_hash is not null as registered, c.created_at, c.anonymous_ids,
        (select count(*)::int from orders o where o.customer_id = c.id) as orders_count,
        (select coalesce(sum(o.total_cents), 0)::bigint from orders o where o.customer_id = c.id and o.status in ('paid','fulfilled','delivered')) as ltv_cents
      from customers c where ${where} order by c.id limit ${limit}`;
  }

  async list(query: { q?: string | undefined; limit: number; cursor: string | null }) {
    const conditions = [sql`true`];
    if (query.q) conditions.push(sql`(c.email ilike ${`%${query.q}%`} or c.name ilike ${`%${query.q}%`})`);
    if (query.cursor) conditions.push(sql`c.id > ${query.cursor}::uuid`);
    const result = await this.db.tx().execute(this.select(sql.join(conditions, sql` and `), query.limit));
    return (result.rows as Array<Record<string, unknown>>).map(toRow);
  }

  async find(id: string) {
    const result = await this.db.tx().execute(this.select(sql`c.id = ${id}`, 1));
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? toRow(row) : null;
  }

  async profile(id: string) {
    const result = await this.db.tx().execute(sql`
      select features, segments, updated_at from customer_profiles where customer_id = ${id} order by updated_at desc limit 1`);
    const row = result.rows[0] as
      { features: Record<string, unknown>; segments: string[]; updated_at: string } | undefined;
    return row
      ? { features: row.features, segments: row.segments, updatedAt: new Date(row.updated_at) }
      : null;
  }
}
