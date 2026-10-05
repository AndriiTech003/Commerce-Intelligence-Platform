import { Inject, Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor, uuidv7 } from '@cip/contracts';
import { NotFoundError, PreconditionRequiredError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import { InventoryService } from '../../inventory';
import { OUTBOX_WRITER, type OutboxWriter } from '../../outbox';
import { TenantService, UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  assertUniqueSkus,
  CategoryNotEmptyError,
  CategoryTooDeepError,
  changedFields,
  childPath,
  depthOf,
  MAX_CATEGORY_DEPTH,
  priceMin,
  ProductVersionConflictError,
  slugify,
  versionOf,
} from '../domain/catalog';
import {
  CATALOG_REPOSITORY,
  IMAGE_STORAGE,
  STOREFRONT_REVALIDATOR,
  type AdminListQuery,
  type CatalogRepository,
  type ImageStorage,
  type ProductRow,
  type ProductStatus,
  type StorefrontRevalidator,
  type VariantRow,
} from './ports';

export interface VariantInput {
  id?: string | undefined;
  sku: string;
  title: string;
  priceCents: number;
  compareAtCents?: number | null | undefined;
  attributes: Record<string, string>;
  onHand: number;
}

export interface ProductInput {
  title: string;
  slug?: string | undefined;
  description: string;
  brand?: string | null | undefined;
  status: ProductStatus;
  categoryId?: string | null | undefined;
  attributes: Record<string, unknown>;
  tags: string[];
  variants: VariantInput[];
}

export type ProductPatch = Partial<Omit<ProductInput, 'variants'>> & {
  variants?: VariantInput[] | undefined;
};

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly repo: CatalogRepository,
    @Inject(IMAGE_STORAGE) private readonly images: ImageStorage,
    @Inject(STOREFRONT_REVALIDATOR) private readonly revalidator: StorefrontRevalidator,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  private categoryView(row: {
    id: string;
    parentId: string | null;
    name: string;
    slug: string;
    path: string;
    productCount?: number;
  }) {
    return { ...row, depth: depthOf(row.path) };
  }

  async listCategories() {
    const rows = await this.uow.run(() => this.repo.listCategories());
    return { data: rows.map((r) => this.categoryView(r)) };
  }

  async createCategory(input: { name: string; slug: string; parentId?: string | null | undefined }) {
    return this.uow.run(async () => {
      const parent = input.parentId ? await this.repo.findCategory(input.parentId) : null;
      if (input.parentId && !parent) throw new NotFoundError('Category', input.parentId);
      const path = childPath(parent?.path ?? null, input.slug);
      if (depthOf(path) > MAX_CATEGORY_DEPTH) throw new CategoryTooDeepError();
      const row = { id: uuidv7(), parentId: parent?.id ?? null, name: input.name, slug: input.slug, path };
      await this.repo.insertCategory(row);
      this.revalidate();
      return this.categoryView({ ...row, productCount: 0 });
    });
  }

  async updateCategory(id: string, patch: { name?: string | undefined; slug?: string | undefined }) {
    return this.uow.run(async () => {
      const current = await this.repo.findCategory(id);
      if (!current) throw new NotFoundError('Category', id);
      await this.repo.updateCategory(id, {
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.slug ? { slug: patch.slug } : {}),
      });
      if (patch.slug && patch.slug !== current.slug) {
        const parentPath = current.path.includes('.')
          ? current.path.slice(0, current.path.lastIndexOf('.'))
          : null;
        await this.repo.moveSubtree(current.path, childPath(parentPath, patch.slug));
      }
      const updated = (await this.repo.findCategory(id))!;
      this.revalidate();
      return { before: this.categoryView(current), after: this.categoryView(updated) };
    });
  }

  async deleteCategory(id: string) {
    return this.uow.run(async () => {
      const current = await this.repo.findCategory(id);
      if (!current) throw new NotFoundError('Category', id);
      if ((await this.repo.countChildren(id)) > 0) throw new CategoryNotEmptyError();
      await this.repo.deleteCategory(id);
      this.revalidate();
      return this.categoryView(current);
    });
  }

  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    let candidate = base;
    for (let i = 2; await this.repo.slugExists(candidate, excludeId); i++) candidate = `${base}-${i}`;
    return candidate;
  }

  private imageUrl(key: string | null): string | null {
    return key ? this.images.publicUrl(key) : null;
  }

  private detail(
    product: ProductRow,
    variants: VariantRow[],
    images: Array<{ id: string; storageKey: string; position: number; alt: string | null }>,
    currency: string,
  ) {
    return {
      id: product.id,
      title: product.title,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      status: product.status,
      categoryId: product.categoryId,
      categoryPath: product.categoryPath,
      categoryName: product.categoryName,
      attributes: product.attributes,
      tags: product.tags,
      priceMinCents: product.priceMinCents,
      currency: variants[0]?.currency ?? currency,
      images: images
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          id: i.id,
          url: this.images.publicUrl(i.storageKey),
          storageKey: i.storageKey,
          position: i.position,
          alt: i.alt,
        })),
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        priceCents: v.priceCents,
        compareAtCents: v.compareAtCents,
        currency: v.currency,
        attributes: v.attributes,
        onHand: v.onHand,
        reserved: v.reserved,
        available: Math.max(0, v.onHand - v.reserved),
      })),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      version: versionOf(product.updatedAt),
    };
  }

  private async loadDetail(id: string) {
    const product = await this.repo.findProduct(id);
    if (!product) throw new NotFoundError('Product', id);
    const variants = await this.repo.variantsOf([id]);
    const images = await this.repo.imagesOf([id]);
    const tenant = await this.tenants.current();
    return this.detail(product, variants, images, tenant.settings.currency);
  }

  getProduct(id: string) {
    return this.uow.run(() => this.loadDetail(id));
  }

  async listProducts(
    query: Omit<AdminListQuery, 'cursor' | 'lowStockThreshold'> & {
      lowStock?: boolean | undefined;
      cursor?: string | undefined;
    },
  ) {
    return this.uow.run(async () => {
      const tenant = await this.tenants.current();
      const rows = await this.repo.listAdmin({
        ...query,
        lowStockThreshold: query.lowStock ? tenant.settings.lowStockThreshold : undefined,
        cursor: decodeCursor(query.cursor),
        limit: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const sortValue = (row: (typeof rows)[number]) =>
        query.sort.includes('title')
          ? row.title_sort
          : query.sort.includes('price')
            ? (row.priceMinCents ?? 0)
            : row.updatedAt.toISOString();
      return {
        data: page.map((r) => ({
          id: r.id,
          title: r.title,
          slug: r.slug,
          brand: r.brand,
          status: r.status,
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          priceMinCents: r.priceMinCents,
          currency: r.currency ?? tenant.settings.currency,
          totalAvailable: r.totalAvailable,
          variantCount: r.variantCount,
          imageUrl: this.imageUrl(r.imageKey),
          updatedAt: r.updatedAt.toISOString(),
        })),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor({ v: sortValue(last), id: last.id }) : null,
      };
    });
  }

  async createProduct(input: ProductInput) {
    assertUniqueSkus(input.variants);
    const result = await this.uow.run(async () => {
      const tenant = await this.tenants.current();
      const id = uuidv7();
      const slug = await this.uniqueSlug(input.slug ?? slugify(input.title));
      if (input.categoryId && !(await this.repo.findCategory(input.categoryId)))
        throw new NotFoundError('Category', input.categoryId);
      await this.repo.insertProduct(id, {
        title: input.title,
        slug,
        description: input.description,
        brand: input.brand ?? null,
        status: input.status,
        categoryId: input.categoryId ?? null,
        attributes: input.attributes,
        tags: input.tags,
        priceMinCents: priceMin(input.variants),
      });
      for (const v of input.variants) {
        const variantId = uuidv7();
        await this.repo.insertVariant(id, {
          id: variantId,
          sku: v.sku,
          title: v.title,
          priceCents: v.priceCents,
          compareAtCents: v.compareAtCents ?? null,
          currency: tenant.settings.currency,
          attributes: v.attributes,
        });
        await this.inventory.initialize(variantId, v.onHand);
      }
      await this.outbox.append({
        aggregateType: 'product',
        aggregateId: id,
        eventType: 'product.upserted',
        payload: { product_id: id, changed_fields: ['created'] },
      });
      return this.loadDetail(id);
    });
    this.revalidate(result.id, result.slug);
    return result;
  }

  async updateProduct(id: string, patch: ProductPatch, ifMatch: string | null) {
    if (!ifMatch) throw new PreconditionRequiredError();
    if (patch.variants) assertUniqueSkus(patch.variants);
    const { before, after } = await this.uow.run(async () => {
      const current = await this.loadDetail(id);
      if (current.version !== ifMatch) throw new ProductVersionConflictError(current.version);
      const tenant = await this.tenants.current();
      let priceMinCents = current.priceMinCents;
      if (patch.variants) {
        const existing = current.variants;
        const keep = new Set<string>();
        for (const v of patch.variants) {
          const match = existing.find(
            (e) => (v.id && e.id === v.id) || (!v.id && e.sku.toLowerCase() === v.sku.toLowerCase()),
          );
          if (match) {
            keep.add(match.id);
            await this.repo.updateVariant({
              id: match.id,
              sku: v.sku,
              title: v.title,
              priceCents: v.priceCents,
              compareAtCents: v.compareAtCents ?? null,
              currency: match.currency,
              attributes: v.attributes,
            });
            if (v.onHand !== match.onHand)
              await this.inventory.setOnHand(match.id, v.onHand, 'manual_adjustment: product form');
          } else {
            const variantId = uuidv7();
            keep.add(variantId);
            await this.repo.insertVariant(id, {
              id: variantId,
              sku: v.sku,
              title: v.title,
              priceCents: v.priceCents,
              compareAtCents: v.compareAtCents ?? null,
              currency: tenant.settings.currency,
              attributes: v.attributes,
            });
            await this.inventory.initialize(variantId, v.onHand);
          }
        }
        const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
        if (removed.length > 0) await this.repo.deleteVariants(removed);
        priceMinCents = priceMin(patch.variants);
      }
      if (patch.categoryId && !(await this.repo.findCategory(patch.categoryId)))
        throw new NotFoundError('Category', patch.categoryId);
      const slug =
        patch.slug && patch.slug !== current.slug ? await this.uniqueSlug(patch.slug, id) : undefined;
      const ok = await this.repo.updateProduct(
        id,
        {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(slug ? { slug } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.brand !== undefined ? { brand: patch.brand ?? null } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId ?? null } : {}),
          ...(patch.attributes !== undefined ? { attributes: patch.attributes } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
          priceMinCents,
        },
        new Date(Number(current.version)),
      );
      if (!ok) throw new ProductVersionConflictError(current.version);
      const updated = await this.loadDetail(id);
      const fields = changedFields(this.auditShape(current), this.auditShape(updated));
      await this.outbox.append({
        aggregateType: 'product',
        aggregateId: id,
        eventType: 'product.upserted',
        payload: { product_id: id, changed_fields: fields },
      });
      return { before: current, after: updated };
    });
    this.revalidate(id, after.slug, before.slug);
    return { before, after };
  }

  auditShape(product: Awaited<ReturnType<CatalogService['loadDetail']>>): Record<string, unknown> {
    return {
      title: product.title,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      status: product.status,
      categoryId: product.categoryId,
      attributes: product.attributes,
      tags: product.tags,
      variants: product.variants.map((v) => ({
        sku: v.sku,
        title: v.title,
        priceCents: v.priceCents,
        compareAtCents: v.compareAtCents,
        onHand: v.onHand,
      })),
      images: product.images.map((i) => i.storageKey),
    };
  }

  async deleteProduct(id: string) {
    const product = await this.uow.run(async () => {
      const current = await this.loadDetail(id);
      await this.repo.deleteProduct(id);
      return current;
    });
    for (const image of product.images) await this.images.delete(image.storageKey);
    this.revalidate(id, product.slug);
    return product;
  }

  async requestImageUpload(
    productId: string,
    input: { filename: string; contentType: string; alt?: string | undefined },
  ) {
    const tenantId = currentContext()?.tenantId ?? '';
    return this.uow.run(async () => {
      const product = await this.repo.findProduct(productId);
      if (!product) throw new NotFoundError('Product', productId);
      const existing = await this.repo.imagesOf([productId]);
      const imageId = uuidv7();
      const storageKey = this.images.keyFor(tenantId, productId, imageId, input.filename);
      const position = existing.reduce((max, i) => Math.max(max, i.position + 1), 0);
      await this.repo.insertImage({ id: imageId, productId, storageKey, position, alt: input.alt ?? null });
      await this.repo.touchProduct(productId);
      const uploadUrl = await this.images.presignPut(storageKey, input.contentType, 600);
      this.revalidate(productId, product.slug);
      return {
        image: {
          id: imageId,
          url: this.images.publicUrl(storageKey),
          storageKey,
          position,
          alt: input.alt ?? null,
        },
        uploadUrl,
        method: 'PUT' as const,
        headers: { 'Content-Type': input.contentType },
        expiresIn: 600,
      };
    });
  }

  async deleteImage(productId: string, imageId: string) {
    const removed = await this.uow.run(async () => {
      const row = await this.repo.deleteImage(productId, imageId);
      if (!row) throw new NotFoundError('Image', imageId);
      await this.repo.touchProduct(productId);
      return row;
    });
    await this.images.delete(removed.storageKey);
    this.revalidate(productId);
    return removed;
  }

  async reorderImages(productId: string, imageIds: string[]) {
    await this.uow.run(async () => {
      if (!(await this.repo.findProduct(productId))) throw new NotFoundError('Product', productId);
      await this.repo.reorderImages(productId, imageIds);
      await this.repo.touchProduct(productId);
    });
    this.revalidate(productId);
    return this.getProduct(productId);
  }

  async storefrontList(query: {
    category?: string | undefined;
    q?: string | undefined;
    sort: 'relevance' | 'newest' | 'price_asc' | 'price_desc';
    priceMin?: number | undefined;
    priceMax?: number | undefined;
    brand?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  }) {
    return this.uow.run(async () => {
      const tenant = await this.tenants.current();
      let categoryPath: string | undefined;
      if (query.category) {
        const category = await this.repo.findCategoryBySlug(query.category);
        if (!category) throw new NotFoundError('Category', query.category);
        categoryPath = category.path;
      }
      const sort = query.q ? query.sort : query.sort === 'relevance' ? 'newest' : query.sort;
      const base = {
        categoryPath,
        q: query.q,
        sort,
        priceMin: query.priceMin,
        priceMax: query.priceMax,
        brand: query.brand,
        limit: query.limit + 1,
        cursor: decodeCursor(query.cursor),
      } as const;
      const rows = await this.repo.listStorefront(base);
      const facets = query.cursor ? null : await this.repo.storefrontFacets({ ...base, brand: undefined });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const cursorValue = (row: (typeof rows)[number]): string | number => {
        if (sort === 'relevance')
          return ((decodeCursor(query.cursor)?.v as number | undefined) ?? 0) + query.limit;
        if (sort === 'newest') return row.createdAt.toISOString();
        return row.priceMinCents ?? 0;
      };
      return {
        data: page.map((r) => ({
          id: r.id,
          title: r.title,
          slug: r.slug,
          brand: r.brand,
          priceMinCents: r.priceMinCents,
          compareAtCents: r.compareAtCents,
          currency: r.currency ?? tenant.settings.currency,
          categoryPath: r.categoryPath,
          imageUrl: this.imageUrl(r.imageKey),
          available: r.available,
        })),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor({ v: cursorValue(last), id: last.id }) : null,
        facets: {
          brands: facets?.brands ?? [],
          priceRange: { min: facets?.min ?? null, max: facets?.max ?? null },
        },
      };
    });
  }

  async storefrontProduct(slug: string) {
    return this.uow.run(async () => {
      const product = await this.repo.findProductBySlug(slug, true);
      if (!product) throw new NotFoundError('Product', slug);
      return this.loadDetail(product.id);
    });
  }

  async suggest(q: string) {
    const products = q.trim().length < 2 ? [] : await this.uow.run(() => this.repo.suggest(q.trim(), 8));
    return { query: q, products };
  }

  revalidate(productId?: string, ...slugs: Array<string | undefined>) {
    const store = currentContext()?.tenantSlug ?? null;
    const tenantId = currentContext()?.tenantId ?? null;
    const tags = [`catalog:${tenantId}`];
    if (productId) tags.push(`product:${productId}`);
    for (const slug of slugs) if (slug) tags.push(`product-slug:${tenantId}:${slug}`);
    if (store) tags.push(`store:${store}`);
    this.revalidator.revalidate(tags);
  }
}
