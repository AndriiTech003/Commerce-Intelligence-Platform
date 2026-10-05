import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { categories, productImages, products, productVariants } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type {
  AdminListQuery,
  AdminListRow,
  CatalogRepository,
  CategoryRow,
  ImageRow,
  ProductRow,
  ProductStatus,
  ProductWrite,
  StorefrontQuery,
  StorefrontRow,
  VariantRow,
  VariantWrite,
} from '../application/ports';

type Row = Record<string, unknown>;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

@Injectable()
export class DrizzleCatalogRepository implements CatalogRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  private async rows<T extends Row>(query: SQL): Promise<T[]> {
    const result = await this.db.tx().execute(query);
    return result.rows as T[];
  }

  async listCategories(): Promise<CategoryRow[]> {
    const rows = await this.rows<Row>(sql`
      select c.id, c.parent_id, c.name, c.slug, c.path::text as path,
        (select count(*)::int from products p join categories c2 on c2.id = p.category_id where c2.path <@ c.path) as product_count
      from categories c order by c.path`);
    return rows.map((r) => ({
      id: String(r.id),
      parentId: (r.parent_id as string | null) ?? null,
      name: String(r.name),
      slug: String(r.slug),
      path: String(r.path),
      productCount: Number(r.product_count ?? 0),
    }));
  }

  private async category(where: SQL): Promise<CategoryRow | null> {
    const [row] = await this.db
      .tx()
      .select({
        id: categories.id,
        parentId: categories.parentId,
        name: categories.name,
        slug: categories.slug,
        path: sql<string>`${categories.path}::text`,
      })
      .from(categories)
      .where(where)
      .limit(1);
    return row ? { ...row, productCount: 0 } : null;
  }

  findCategory(id: string) {
    return this.category(eq(categories.id, id));
  }

  findCategoryBySlug(slug: string) {
    return this.category(eq(categories.slug, slug));
  }

  async insertCategory(row: {
    id: string;
    parentId: string | null;
    name: string;
    slug: string;
    path: string;
  }) {
    await this.db
      .tx()
      .insert(categories)
      .values({ ...row, tenantId: this.db.tenantId() });
  }

  async updateCategory(id: string, patch: { name?: string; slug?: string }) {
    if (Object.keys(patch).length === 0) return;
    await this.db.tx().update(categories).set(patch).where(eq(categories.id, id));
  }

  async moveSubtree(oldPath: string, newPath: string) {
    await this.db.tx().execute(sql`
      update categories set path = case when path = ${oldPath}::ltree then ${newPath}::ltree else ${newPath}::ltree || subpath(path, nlevel(${oldPath}::ltree)) end
      where path <@ ${oldPath}::ltree`);
  }

  async countChildren(id: string) {
    const [row] = await this.rows<{ n: number }>(
      sql`select count(*)::int as n from categories where parent_id = ${id}`,
    );
    return Number(row?.n ?? 0);
  }

  async deleteCategory(id: string) {
    await this.db.tx().update(products).set({ categoryId: null }).where(eq(products.categoryId, id));
    await this.db.tx().delete(categories).where(eq(categories.id, id));
  }

  async slugExists(slug: string, excludeId?: string) {
    const rows = await this.db
      .tx()
      .select({ id: products.id })
      .from(products)
      .where(
        excludeId
          ? and(eq(products.slug, slug), sql`${products.id} <> ${excludeId}`)
          : eq(products.slug, slug),
      )
      .limit(1);
    return rows.length > 0;
  }

  async insertProduct(id: string, product: ProductWrite) {
    await this.db
      .tx()
      .insert(products)
      .values({
        id,
        tenantId: this.db.tenantId(),
        ...product,
        updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
      });
  }

  async updateProduct(id: string, product: Partial<ProductWrite>, expectedUpdatedAt: Date | null) {
    const rows = await this.db
      .tx()
      .update(products)
      .set({
        ...product,
        updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), ${products.updatedAt} + interval '1 millisecond')`,
      })
      .where(
        expectedUpdatedAt
          ? and(
              eq(products.id, id),
              sql`date_trunc('milliseconds', ${products.updatedAt}) = ${expectedUpdatedAt.toISOString()}::timestamptz`,
            )
          : eq(products.id, id),
      )
      .returning({ id: products.id });
    return rows.length > 0;
  }

  async touchProduct(id: string) {
    await this.updateProduct(id, {}, null);
  }

  private productSelect(where: SQL): SQL {
    return sql`
      select p.id, p.title, p.slug, p.description, p.brand, p.status, p.category_id, c.path::text as category_path,
        c.name as category_name, p.attributes, p.tags, p.price_min_cents, p.created_at, p.updated_at
      from products p left join categories c on c.id = p.category_id
      where ${where} limit 1`;
  }

  private toProduct(r: Row): ProductRow {
    return {
      id: String(r.id),
      title: String(r.title),
      slug: String(r.slug),
      description: String(r.description ?? ''),
      brand: (r.brand as string | null) ?? null,
      status: r.status as ProductStatus,
      categoryId: (r.category_id as string | null) ?? null,
      categoryPath: (r.category_path as string | null) ?? null,
      categoryName: (r.category_name as string | null) ?? null,
      attributes: (r.attributes as Record<string, unknown>) ?? {},
      tags: (r.tags as string[]) ?? [],
      priceMinCents: num(r.price_min_cents),
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    };
  }

  async findProduct(id: string) {
    const [row] = await this.rows<Row>(this.productSelect(sql`p.id = ${id}`));
    return row ? this.toProduct(row) : null;
  }

  async findProductBySlug(slug: string, activeOnly: boolean) {
    const [row] = await this.rows<Row>(
      this.productSelect(activeOnly ? sql`p.slug = ${slug} and p.status = 'active'` : sql`p.slug = ${slug}`),
    );
    return row ? this.toProduct(row) : null;
  }

  async deleteProduct(id: string) {
    const rows = await this.db
      .tx()
      .delete(products)
      .where(eq(products.id, id))
      .returning({ id: products.id });
    return rows.length > 0;
  }

  async variantsOf(productIds: string[]): Promise<VariantRow[]> {
    if (productIds.length === 0) return [];
    const rows = await this.rows<Row>(sql`
      select v.id, v.product_id, v.sku, v.title, v.price_cents, v.compare_at_cents, v.currency, v.attributes,
        coalesce(i.on_hand, 0) as on_hand, coalesce(i.reserved, 0) as reserved
      from product_variants v left join inventory_items i on i.variant_id = v.id
      where v.product_id in (${sql.join(
        productIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      order by v.price_cents, v.sku`);
    return rows.map((r) => ({
      id: String(r.id),
      productId: String(r.product_id),
      sku: String(r.sku),
      title: String(r.title),
      priceCents: Number(r.price_cents),
      compareAtCents: num(r.compare_at_cents),
      currency: String(r.currency),
      attributes: (r.attributes as Record<string, string>) ?? {},
      onHand: Number(r.on_hand),
      reserved: Number(r.reserved),
    }));
  }

  async insertVariant(productId: string, variant: VariantWrite) {
    await this.db
      .tx()
      .insert(productVariants)
      .values({ ...variant, productId, tenantId: this.db.tenantId() });
  }

  async updateVariant(variant: VariantWrite) {
    const { id, ...rest } = variant;
    await this.db.tx().update(productVariants).set(rest).where(eq(productVariants.id, id));
  }

  async deleteVariants(ids: string[]) {
    if (ids.length === 0) return;
    await this.db.tx().delete(productVariants).where(inArray(productVariants.id, ids));
  }

  async imagesOf(productIds: string[]): Promise<ImageRow[]> {
    if (productIds.length === 0) return [];
    return this.db
      .tx()
      .select({
        id: productImages.id,
        productId: productImages.productId,
        storageKey: productImages.storageKey,
        position: productImages.position,
        alt: productImages.alt,
      })
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(asc(productImages.position));
  }

  async insertImage(row: ImageRow) {
    await this.db
      .tx()
      .insert(productImages)
      .values({ ...row, tenantId: this.db.tenantId() });
  }

  async deleteImage(productId: string, imageId: string) {
    const [row] = await this.db
      .tx()
      .delete(productImages)
      .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
      .returning({
        id: productImages.id,
        productId: productImages.productId,
        storageKey: productImages.storageKey,
        position: productImages.position,
        alt: productImages.alt,
      });
    return row ?? null;
  }

  async reorderImages(productId: string, imageIds: string[]) {
    let position = 0;
    for (const id of imageIds) {
      await this.db
        .tx()
        .update(productImages)
        .set({ position: position++ })
        .where(and(eq(productImages.id, id), eq(productImages.productId, productId)));
    }
  }

  private searchCondition(q: string): SQL {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    return sql`(p.search_tsv @@ websearch_to_tsquery('simple', ${q}) or p.title % ${q} or p.title ilike ${like} or p.brand ilike ${like})`;
  }

  private searchRank(q: string): SQL {
    return sql`(ts_rank(p.search_tsv, websearch_to_tsquery('simple', ${q})) + similarity(p.title, ${q}))`;
  }

  async listAdmin(query: AdminListQuery): Promise<AdminListRow[]> {
    const where: SQL[] = [sql`true`];
    if (query.q) where.push(this.searchCondition(query.q));
    if (query.status) where.push(sql`p.status = ${query.status}`);
    if (query.categoryId) where.push(sql`p.category_id = ${query.categoryId}`);
    if (query.lowStockThreshold !== undefined) {
      where.push(sql`exists (select 1 from product_variants v join inventory_items i on i.variant_id = v.id
        where v.product_id = p.id and i.on_hand - i.reserved <= ${query.lowStockThreshold})`);
    }
    const desc = query.sort.startsWith('-');
    const field = query.sort.replace('-', '');
    const column =
      field === 'title'
        ? sql`lower(p.title)`
        : field === 'price'
          ? sql`coalesce(p.price_min_cents, 0)`
          : sql`p.updated_at`;
    if (query.cursor) {
      const value =
        field === 'title'
          ? sql`${String(query.cursor.v)}`
          : field === 'price'
            ? sql`${Number(query.cursor.v)}::bigint`
            : sql`${String(query.cursor.v)}::timestamptz`;
      where.push(
        desc
          ? sql`(${column}, p.id) < (${value}, ${query.cursor.id}::uuid)`
          : sql`(${column}, p.id) > (${value}, ${query.cursor.id}::uuid)`,
      );
    }
    const order = desc ? sql`${column} desc, p.id desc` : sql`${column} asc, p.id asc`;
    const rows = await this.rows<Row>(sql`
      select p.id, p.title, p.slug, p.brand, p.status, p.category_id, c.name as category_name, p.price_min_cents,
        p.updated_at, lower(p.title) as title_sort,
        (select min(v.currency) from product_variants v where v.product_id = p.id) as currency,
        (select coalesce(sum(i.on_hand - i.reserved), 0)::int from product_variants v join inventory_items i on i.variant_id = v.id where v.product_id = p.id) as total_available,
        (select count(*)::int from product_variants v where v.product_id = p.id) as variant_count,
        (select pi.storage_key from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_key
      from products p left join categories c on c.id = p.category_id
      where ${sql.join(where, sql` and `)}
      order by ${order}
      limit ${query.limit}`);
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      slug: String(r.slug),
      brand: (r.brand as string | null) ?? null,
      status: r.status as ProductStatus,
      categoryId: (r.category_id as string | null) ?? null,
      categoryName: (r.category_name as string | null) ?? null,
      priceMinCents: num(r.price_min_cents),
      currency: (r.currency as string | null) ?? null,
      totalAvailable: Number(r.total_available ?? 0),
      variantCount: Number(r.variant_count ?? 0),
      imageKey: (r.image_key as string | null) ?? null,
      updatedAt: toDate(r.updated_at),
      title_sort: String(r.title_sort),
    }));
  }

  private storefrontWhere(query: StorefrontQuery, includeBrand: boolean): SQL[] {
    const where: SQL[] = [sql`p.status = 'active'`];
    if (query.categoryPath) where.push(sql`c.path <@ ${query.categoryPath}::ltree`);
    if (query.q) where.push(this.searchCondition(query.q));
    if (query.priceMin !== undefined) where.push(sql`p.price_min_cents >= ${query.priceMin}`);
    if (query.priceMax !== undefined) where.push(sql`p.price_min_cents <= ${query.priceMax}`);
    if (includeBrand && query.brand) where.push(sql`p.brand = ${query.brand}`);
    return where;
  }

  async listStorefront(query: StorefrontQuery): Promise<StorefrontRow[]> {
    const where = this.storefrontWhere(query, true);
    const rank = query.q ? this.searchRank(query.q) : sql`0`;
    let order: SQL;
    let offset = 0;
    switch (query.sort) {
      case 'relevance':
        order = sql`${rank} desc, p.id`;
        offset = Number(query.cursor?.v ?? 0);
        break;
      case 'price_asc':
        order = sql`coalesce(p.price_min_cents, 0) asc, p.id asc`;
        if (query.cursor)
          where.push(
            sql`(coalesce(p.price_min_cents, 0), p.id) > (${Number(query.cursor.v)}::bigint, ${query.cursor.id}::uuid)`,
          );
        break;
      case 'price_desc':
        order = sql`coalesce(p.price_min_cents, 0) desc, p.id desc`;
        if (query.cursor)
          where.push(
            sql`(coalesce(p.price_min_cents, 0), p.id) < (${Number(query.cursor.v)}::bigint, ${query.cursor.id}::uuid)`,
          );
        break;
      default:
        order = sql`p.created_at desc, p.id desc`;
        if (query.cursor)
          where.push(
            sql`(p.created_at, p.id) < (${String(query.cursor.v)}::timestamptz, ${query.cursor.id}::uuid)`,
          );
    }
    const rows = await this.rows<Row>(sql`
      select p.id, p.title, p.slug, p.brand, p.price_min_cents, p.created_at, c.path::text as category_path,
        ${rank} as rank,
        (select max(v.compare_at_cents) from product_variants v where v.product_id = p.id) as compare_at_cents,
        (select min(v.currency) from product_variants v where v.product_id = p.id) as currency,
        (select pi.storage_key from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_key,
        coalesce((select bool_or(i.on_hand - i.reserved > 0) from product_variants v join inventory_items i on i.variant_id = v.id where v.product_id = p.id), false) as available
      from products p left join categories c on c.id = p.category_id
      where ${sql.join(where, sql` and `)}
      order by ${order}
      limit ${query.limit} offset ${offset}`);
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
      createdAt: toDate(r.created_at),
      rank: Number(r.rank ?? 0),
    }));
  }

  async storefrontFacets(query: StorefrontQuery) {
    const where = this.storefrontWhere(query, false);
    const brands = await this.rows<Row>(sql`
      select p.brand as value, count(*)::int as count from products p left join categories c on c.id = p.category_id
      where ${sql.join(where, sql` and `)} and p.brand is not null group by p.brand order by count desc, p.brand limit 30`);
    const [range] = await this.rows<Row>(sql`
      select min(p.price_min_cents) as min, max(p.price_min_cents) as max from products p left join categories c on c.id = p.category_id
      where ${sql.join(where, sql` and `)}`);
    return {
      brands: brands.map((b) => ({ value: String(b.value), count: Number(b.count) })),
      min: num(range?.min),
      max: num(range?.max),
    };
  }

  async suggest(q: string, limit: number) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const rows = await this.rows<Row>(sql`
      select p.id, p.title, p.slug, greatest(word_similarity(${q}, p.title), similarity(p.title, ${q})) as score
      from products p
      where p.status = 'active' and (p.title ilike ${like} or word_similarity(${q}, p.title) > 0.3 or p.title % ${q})
      order by (p.title ilike ${`${q.replace(/[%_]/g, '')}%`}) desc, score desc, p.title
      limit ${limit}`);
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      slug: String(r.slug),
      score: Number(r.score),
    }));
  }
}
