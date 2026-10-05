import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { parseVector, vectorLiteral, type PriceQuantiles } from '@cip/personalization';
import { TenantDatabase } from '../../tenancy';
import type { CandidateQueries, CandidateRow, ProductSelectorQuery, ScoredId } from '../application/ports';

type Row = Record<string, unknown>;

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

const IN_STOCK = sql`exists (select 1 from product_variants v join inventory_items i on i.variant_id = v.id where v.product_id = p.id and i.on_hand - i.reserved > 0)`;

const AVAILABLE = sql`coalesce((select bool_or(i.on_hand - i.reserved > 0) from product_variants v join inventory_items i on i.variant_id = v.id where v.product_id = p.id), false)`;

@Injectable()
export class DrizzleCandidateQueries implements CandidateQueries {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.tx().execute(query)).rows as Row[];
  }

  async byIds(ids: string[]): Promise<CandidateRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.rows(sql`
      select p.id, p.title, p.slug, p.brand, p.price_min_cents, p.status, p.created_at, c.path::text as category_path,
        p.embedding::text as embedding,
        (select max(v.compare_at_cents) from product_variants v where v.product_id = p.id) as compare_at_cents,
        (select min(v.currency) from product_variants v where v.product_id = p.id) as currency,
        (select pi.storage_key from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_key,
        ${AVAILABLE} as available
      from products p left join categories c on c.id = p.category_id
      where p.id = any(${`{${ids.join(',')}}`}::uuid[])`);
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      slug: String(r.slug),
      brand: (r.brand as string | null) ?? null,
      priceMinCents: num(r.price_min_cents),
      compareAtCents: num(r.compare_at_cents),
      currency: (r.currency as string | null) ?? null,
      categoryPath: (r.category_path as string | null) ?? null,
      imageKey: (r.image_key as string | null) ?? null,
      available: Boolean(r.available),
      status: String(r.status),
      createdAt: new Date(String(r.created_at)),
      embedding: parseVector(r.embedding),
    }));
  }

  async nearest(vector: number[], limit: number, excludeIds: string[]): Promise<ScoredId[]> {
    await this.db.tx().execute(sql`select set_config('hnsw.ef_search', '200', true)`);
    await this.db.tx().execute(sql`select set_config('hnsw.iterative_scan', 'relaxed_order', true)`);
    const literal = vectorLiteral(vector);
    const rows = await this.rows(sql`
      select p.id, 1 - (p.embedding <=> ${literal}::vector) as similarity
      from products p
      where p.tenant_id = ${this.db.tenantId()}::uuid and p.status = 'active' and p.embedding is not null
        and not (p.id = any(${`{${excludeIds.join(',')}}`}::uuid[]))
        and ${IN_STOCK}
      order by p.embedding <=> ${literal}::vector
      limit ${limit}`);
    return rows
      .map((r) => ({ id: String(r.id), score: Number(r.similarity) }))
      .sort((a, b) => b.score - a.score);
  }

  async embedding(productId: string): Promise<number[] | null> {
    const [row] = await this.rows(
      sql`select embedding::text as embedding from products where id = ${productId}::uuid`,
    );
    return row ? parseVector(row.embedding) : null;
  }

  async fallbackPopular(categoryPath: string | null, limit: number): Promise<string[]> {
    const rows = await this.rows(sql`
      select p.id from products p left join categories c on c.id = p.category_id
      where p.status = 'active' and ${categoryPath ? sql`c.path <@ ${categoryPath}::ltree` : sql`true`} and ${IN_STOCK}
      order by p.created_at desc, p.id limit ${limit}`);
    return rows.map((r) => String(r.id));
  }

  private selectorWhere(selector: ProductSelectorQuery): SQL[] {
    const where: SQL[] = [sql`p.status = 'active'`];
    if (selector.categoryPath) {
      const path = selector.categoryPath.replace(/\.\*$/, '').replace(/-/g, '_');
      where.push(sql`c.path <@ ${path}::ltree`);
    }
    if (selector.brands?.length)
      where.push(
        sql`p.brand = any(${`{${selector.brands.map((b) => `"${b.replace(/"/g, '')}"`).join(',')}}`}::text[])`,
      );
    if (selector.priceMin !== undefined) where.push(sql`p.price_min_cents >= ${selector.priceMin}`);
    if (selector.priceMax !== undefined) where.push(sql`p.price_min_cents <= ${selector.priceMax}`);
    if (selector.productIds?.length)
      where.push(sql`p.id = any(${`{${selector.productIds.join(',')}}`}::uuid[])`);
    if (selector.q) where.push(sql`p.title ilike ${`%${selector.q.replace(/[%_]/g, '')}%`}`);
    return where;
  }

  async select(selector: ProductSelectorQuery, limit: number) {
    const where = sql.join(this.selectorWhere(selector), sql` and `);
    const [count] = await this.rows(sql`
      select count(*)::int as n from products p left join categories c on c.id = p.category_id where ${where}`);
    const rows = await this.rows(sql`
      select p.id from products p left join categories c on c.id = p.category_id
      where ${where} order by ${AVAILABLE} desc, p.created_at desc, p.id limit ${limit}`);
    return { total: Number(count?.n ?? 0), ids: rows.map((r) => String(r.id)) };
  }

  async catalogQuantiles(): Promise<PriceQuantiles> {
    const rows = await this.rows(sql`
      select coalesce(split_part(c.path::text, '.', 1), '_all') as top,
        percentile_cont(0.33) within group (order by p.price_min_cents) as q1,
        percentile_cont(0.66) within group (order by p.price_min_cents) as q2
      from products p left join categories c on c.id = p.category_id
      where p.price_min_cents is not null and p.status = 'active'
      group by grouping sets ((split_part(c.path::text, '.', 1)), ())`);
    const out: PriceQuantiles = {};
    for (const r of rows) {
      const key = r.top === null || r.top === undefined ? '_all' : String(r.top);
      out[key || '_all'] = [Number(r.q1), Number(r.q2)];
    }
    return out;
  }

  async categoryNames(): Promise<Record<string, string>> {
    const rows = await this.rows(sql`select path::text as path, name from categories`);
    return Object.fromEntries(rows.map((r) => [String(r.path), String(r.name)]));
  }
}
