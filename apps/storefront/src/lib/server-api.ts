import type { CatalogQuery } from './catalog-query';
import { toSearchString } from './catalog-query';
import type { CategoryList, ProductDetail, ProductList, StoreInfo } from './types';

export const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
export const CATALOG_REVALIDATE = 60;

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`API ${path} responded with ${status}`);
    this.name = 'UpstreamError';
  }
}

export const storeTag = (slug: string) => `store:${slug}`;
export const catalogTag = (tenantId: string) => `catalog:${tenantId}`;
export const productSlugTag = (tenantId: string, slug: string) => `product-slug:${tenantId}:${slug}`;

type CacheMode = { revalidate: number; tags: string[] } | 'no-store';

async function apiGet<T>(store: string, path: string, cache: CacheMode): Promise<T | null> {
  const init: RequestInit & { next?: { revalidate: number; tags: string[] } } = {
    headers: { 'x-store': store, accept: 'application/json' },
  };
  if (cache === 'no-store') init.cache = 'no-store';
  else init.next = { revalidate: cache.revalidate, tags: cache.tags };
  const response = await fetch(`${API_INTERNAL_URL}${path}`, init);
  if (response.status === 404) return null;
  if (!response.ok) throw new UpstreamError(response.status, path);
  return (await response.json()) as T;
}

export function getStore(slug: string): Promise<StoreInfo | null> {
  return apiGet<StoreInfo>(slug, '/v1/storefront/store', {
    revalidate: CATALOG_REVALIDATE,
    tags: [storeTag(slug)],
  });
}

export async function getCategories(store: StoreInfo): Promise<CategoryList['data']> {
  const result = await apiGet<CategoryList>(store.slug, '/v1/storefront/catalog/categories', {
    revalidate: CATALOG_REVALIDATE,
    tags: [catalogTag(store.id)],
  });
  return result?.data ?? [];
}

const EMPTY_LIST: ProductList = {
  data: [],
  nextCursor: null,
  facets: { brands: [], priceRange: { min: null, max: null } },
};

export async function getProducts(store: StoreInfo, query: CatalogQuery): Promise<ProductList> {
  const result = await apiGet<ProductList>(
    store.slug,
    `/v1/storefront/catalog/products${toSearchString(query)}`,
    { revalidate: CATALOG_REVALIDATE, tags: [catalogTag(store.id)] },
  );
  return result ?? EMPTY_LIST;
}

export async function searchProducts(store: StoreInfo, query: CatalogQuery): Promise<ProductList> {
  const result = await apiGet<ProductList>(
    store.slug,
    `/v1/storefront/catalog/products${toSearchString(query)}`,
    'no-store',
  );
  return result ?? EMPTY_LIST;
}

export function getProduct(store: StoreInfo, slug: string): Promise<ProductDetail | null> {
  return apiGet<ProductDetail>(store.slug, `/v1/storefront/catalog/products/${encodeURIComponent(slug)}`, {
    revalidate: CATALOG_REVALIDATE,
    tags: [catalogTag(store.id), productSlugTag(store.id, slug)],
  });
}
