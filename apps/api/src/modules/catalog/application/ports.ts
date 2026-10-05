import type { Permission } from '@cip/contracts';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
export const IMAGE_STORAGE = Symbol('IMAGE_STORAGE');
export const STOREFRONT_REVALIDATOR = Symbol('STOREFRONT_REVALIDATOR');

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  productCount: number;
}

export interface ProductRow {
  id: string;
  title: string;
  slug: string;
  description: string;
  brand: string | null;
  status: ProductStatus;
  categoryId: string | null;
  categoryPath: string | null;
  categoryName: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  priceMinCents: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VariantRow {
  id: string;
  productId: string;
  sku: string;
  title: string;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  attributes: Record<string, string>;
  onHand: number;
  reserved: number;
}

export interface ImageRow {
  id: string;
  productId: string;
  storageKey: string;
  position: number;
  alt: string | null;
}

export interface ProductWrite {
  title: string;
  slug: string;
  description: string;
  brand: string | null;
  status: ProductStatus;
  categoryId: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  priceMinCents: number | null;
}

export interface VariantWrite {
  id: string;
  sku: string;
  title: string;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  attributes: Record<string, string>;
}

export interface AdminListQuery {
  q?: string | undefined;
  status?: ProductStatus | undefined;
  categoryId?: string | undefined;
  lowStockThreshold?: number | undefined;
  sort: string;
  limit: number;
  cursor: { v: string | number; id: string } | null;
}

export interface AdminListRow {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  status: ProductStatus;
  categoryId: string | null;
  categoryName: string | null;
  priceMinCents: number | null;
  currency: string | null;
  totalAvailable: number;
  variantCount: number;
  imageKey: string | null;
  updatedAt: Date;
  title_sort: string;
}

export interface StorefrontQuery {
  categoryPath?: string | undefined;
  q?: string | undefined;
  sort: 'relevance' | 'newest' | 'price_asc' | 'price_desc';
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  brand?: string | undefined;
  limit: number;
  cursor: { v: string | number; id: string } | null;
}

export interface StorefrontRow {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  priceMinCents: number | null;
  compareAtCents: number | null;
  currency: string | null;
  categoryPath: string | null;
  imageKey: string | null;
  available: boolean;
  createdAt: Date;
  rank: number;
}

export interface CatalogRepository {
  listCategories(): Promise<CategoryRow[]>;
  findCategory(id: string): Promise<CategoryRow | null>;
  findCategoryBySlug(slug: string): Promise<CategoryRow | null>;
  insertCategory(row: {
    id: string;
    parentId: string | null;
    name: string;
    slug: string;
    path: string;
  }): Promise<void>;
  updateCategory(id: string, patch: { name?: string; slug?: string }): Promise<void>;
  moveSubtree(oldPath: string, newPath: string): Promise<void>;
  countChildren(id: string): Promise<number>;
  deleteCategory(id: string): Promise<void>;

  slugExists(slug: string, excludeId?: string): Promise<boolean>;
  insertProduct(id: string, product: ProductWrite): Promise<void>;
  updateProduct(id: string, product: Partial<ProductWrite>, expectedUpdatedAt: Date | null): Promise<boolean>;
  touchProduct(id: string): Promise<void>;
  findProduct(id: string): Promise<ProductRow | null>;
  findProductBySlug(slug: string, activeOnly: boolean): Promise<ProductRow | null>;
  deleteProduct(id: string): Promise<boolean>;
  variantsOf(productIds: string[]): Promise<VariantRow[]>;
  insertVariant(productId: string, variant: VariantWrite): Promise<void>;
  updateVariant(variant: VariantWrite): Promise<void>;
  deleteVariants(ids: string[]): Promise<void>;
  imagesOf(productIds: string[]): Promise<ImageRow[]>;
  insertImage(row: ImageRow): Promise<void>;
  deleteImage(productId: string, imageId: string): Promise<ImageRow | null>;
  reorderImages(productId: string, imageIds: string[]): Promise<void>;
  listAdmin(query: AdminListQuery): Promise<AdminListRow[]>;
  listStorefront(query: StorefrontQuery): Promise<StorefrontRow[]>;
  storefrontFacets(
    query: StorefrontQuery,
  ): Promise<{ brands: Array<{ value: string; count: number }>; min: number | null; max: number | null }>;
  suggest(
    q: string,
    limit: number,
  ): Promise<Array<{ id: string; title: string; slug: string; score: number }>>;
}

export interface ImageStorage {
  keyFor(tenantId: string, productId: string, imageId: string, filename: string): string;
  presignPut(key: string, contentType: string, expiresIn: number): Promise<string>;
  publicUrl(key: string): string;
  delete(key: string): Promise<void>;
}

export interface StorefrontRevalidator {
  revalidate(tags: string[]): void;
}

export type { Permission };
