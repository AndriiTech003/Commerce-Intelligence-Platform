import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDatabase } from '../../tenancy';
import type { ProfileSnapshot, ProfileSnapshotRepository } from '../application/ports';

type Row = Record<string, unknown>;

function toSnapshot(r: Row): ProfileSnapshot {
  return {
    profileId: String(r.profile_id),
    customerId: (r.customer_id as string | null) ?? null,
    features: (r.features as Record<string, unknown>) ?? {},
    segments: (r.segments as string[]) ?? [],
    updatedAt: new Date(String(r.updated_at)),
  };
}

@Injectable()
export class DrizzleProfileSnapshotRepository implements ProfileSnapshotRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return (await this.db.tx().execute(query)).rows as Row[];
  }

  async upsert(rows: ProfileSnapshot[]) {
    if (rows.length === 0) return;
    const tenantId = this.db.tenantId();
    await this.db.tx().execute(sql`
      insert into customer_profiles (tenant_id, profile_id, customer_id, features, segments, updated_at)
      select ${tenantId}::uuid, v.profile_id, v.customer_id, v.features, v.segments, v.updated_at
        from jsonb_to_recordset(${JSON.stringify(
          rows.map((r) => ({
            profile_id: r.profileId,
            customer_id: r.customerId,
            features: r.features,
            segments: r.segments,
            updated_at: r.updatedAt.toISOString(),
          })),
        )}::jsonb) as v(profile_id uuid, customer_id uuid, features jsonb, segments text[], updated_at timestamptz)
      on conflict (tenant_id, profile_id) do update set
        customer_id = coalesce(excluded.customer_id, customer_profiles.customer_id),
        features = excluded.features, segments = excluded.segments, updated_at = excluded.updated_at`);
  }

  async find(profileId: string) {
    const [row] = await this.rows(
      sql`select * from customer_profiles where profile_id = ${profileId}::uuid limit 1`,
    );
    return row ? toSnapshot(row) : null;
  }

  async findByCustomer(customerId: string) {
    const [row] = await this.rows(sql`
      select * from customer_profiles where customer_id = ${customerId}::uuid or profile_id = ${customerId}::uuid
      order by (profile_id = ${customerId}::uuid) desc, updated_at desc limit 1`);
    return row ? toSnapshot(row) : null;
  }

  async recent(limit: number) {
    return (
      await this.rows(sql`select * from customer_profiles order by updated_at desc limit ${limit}`)
    ).map(toSnapshot);
  }

  async count() {
    const [row] = await this.rows(sql`select count(*)::int as n from customer_profiles`);
    return Number(row?.n ?? 0);
  }

  async memberCounts() {
    const rows = await this.rows(sql`
      select k, count(*)::int as n from customer_profiles, unnest(segments) as k group by k`);
    return Object.fromEntries(rows.map((r) => [String(r.k), Number(r.n)]));
  }

  async ltvOfCustomers() {
    const rows = await this.rows(sql`
      select (features->>'ltv_cents')::float8 as ltv from customer_profiles
      where coalesce((features->>'orders_count')::float8, 0) >= 1`);
    return rows.map((r) => Number(r.ltv)).filter((v) => Number.isFinite(v));
  }
}
