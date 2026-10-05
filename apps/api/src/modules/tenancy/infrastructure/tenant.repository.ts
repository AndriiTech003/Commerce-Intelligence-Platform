import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { tenants } from '../../../db/schema';
import { normalizeSettings, type Tenant, type TenantSettings } from '../domain/tenant';
import type { TenantRepository } from '../application/ports';
import { TenantDatabase } from './tenant-database';

function toTenant(row: typeof tenants.$inferSelect): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    settings: normalizeSettings(row.settings),
    createdAt: row.createdAt,
  };
}

@Injectable()
export class DrizzleTenantRepository implements TenantRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async findBySlug(slug: string): Promise<Tenant | null> {
    const [row] = await this.db.executor().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return row ? toTenant(row) : null;
  }

  async findById(id: string): Promise<Tenant | null> {
    const [row] = await this.db.executor().select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return row ? toTenant(row) : null;
  }

  async create(input: { id: string; slug: string; name: string; settings: TenantSettings }): Promise<Tenant> {
    const [row] = await this.db
      .executor()
      .insert(tenants)
      .values({ id: input.id, slug: input.slug, name: input.name, settings: { ...input.settings } })
      .returning();
    return toTenant(row!);
  }

  async update(id: string, patch: { name?: string; settings?: TenantSettings }): Promise<Tenant> {
    const [row] = await this.db
      .executor()
      .update(tenants)
      .set({
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.settings ? { settings: { ...patch.settings } } : {}),
      })
      .where(eq(tenants.id, id))
      .returning();
    return toTenant(row!);
  }

  async listAll() {
    const result = await this.db.system.execute<{
      id: string;
      slug: string;
      name: string;
      status: string;
      settings: Record<string, unknown>;
      created_at: Date;
      members: number;
      products: number;
      orders: number;
    }>(sql`
      select t.id, t.slug, t.name, t.status, t.settings, t.created_at,
        (select count(*)::int from memberships m where m.tenant_id = t.id) as members,
        (select count(*)::int from products p where p.tenant_id = t.id) as products,
        (select count(*)::int from orders o where o.tenant_id = t.id) as orders
      from tenants t order by t.created_at`);
    return result.rows.map((r) => ({
      ...toTenant({
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        settings: r.settings,
        createdAt: new Date(r.created_at),
      }),
      members: r.members,
      products: r.products,
      orders: r.orders,
    }));
  }
}
