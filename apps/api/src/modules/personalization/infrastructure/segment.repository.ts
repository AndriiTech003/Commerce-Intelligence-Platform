import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type { RuleGroup } from '@cip/personalization';
import { segments } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { SegmentRecord, SegmentRepository } from '../application/ports';

function toRecord(row: typeof segments.$inferSelect): SegmentRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    rules: row.rules as unknown as RuleGroup,
    priority: row.priority,
    isSystem: row.isSystem,
  };
}

@Injectable()
export class DrizzleSegmentRepository implements SegmentRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async list() {
    return (
      await this.db.tx().select().from(segments).orderBy(asc(segments.priority), asc(segments.key))
    ).map(toRecord);
  }

  async find(id: string) {
    const [row] = await this.db.tx().select().from(segments).where(eq(segments.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async findByKey(key: string) {
    const [row] = await this.db.tx().select().from(segments).where(eq(segments.key, key)).limit(1);
    return row ? toRecord(row) : null;
  }

  async insert(record: SegmentRecord) {
    await this.db
      .tx()
      .insert(segments)
      .values({
        ...record,
        rules: record.rules as unknown as Record<string, unknown>,
        tenantId: this.db.tenantId(),
      });
  }

  async update(id: string, patch: Partial<Omit<SegmentRecord, 'id' | 'key' | 'isSystem'>>) {
    const values: Partial<typeof segments.$inferInsert> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.priority !== undefined) values.priority = patch.priority;
    if (patch.rules !== undefined) values.rules = patch.rules as unknown as Record<string, unknown>;
    if (Object.keys(values).length === 0) return;
    await this.db.tx().update(segments).set(values).where(eq(segments.id, id));
  }

  async remove(id: string) {
    const rows = await this.db
      .tx()
      .delete(segments)
      .where(eq(segments.id, id))
      .returning({ id: segments.id });
    return rows.length > 0;
  }

  async categories() {
    const result = await this.db.tx().execute(sql`select path::text as path from categories order by path`);
    return (result.rows as Array<{ path: string }>).map((r) => r.path);
  }

  async brands() {
    const result = await this.db
      .tx()
      .execute(sql`select distinct brand from products where brand is not null order by brand limit 200`);
    return (result.rows as Array<{ brand: string }>).map((r) => r.brand);
  }
}
