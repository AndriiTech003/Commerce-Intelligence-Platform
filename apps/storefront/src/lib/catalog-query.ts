import { parsePriceFilter } from './price-filter';

export const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABELS: Record<Sort, string> = {
  relevance: 'Featured',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
};

export interface CatalogQuery {
  category?: string;
  q?: string;
  sort?: Sort;
  priceMin?: number;
  priceMax?: number;
  brand?: string;
  limit?: number;
  cursor?: string;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isSort(value: string | undefined): value is Sort {
  return value !== undefined && (SORTS as readonly string[]).includes(value);
}

export function catalogQueryFromParams(params: RawSearchParams, base: CatalogQuery = {}): CatalogQuery {
  const query: CatalogQuery = { ...base };
  const sort = firstParam(params.sort);
  if (isSort(sort)) query.sort = sort;
  const brand = firstParam(params.brand)?.trim();
  if (brand) query.brand = brand;
  const price = parsePriceFilter(firstParam(params.price));
  if (price.minCents !== null) query.priceMin = price.minCents;
  if (price.maxCents !== null) query.priceMax = price.maxCents;
  return query;
}

export function toSearchString(query: CatalogQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function buildFilterHref(
  pathname: string,
  current: RawSearchParams,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const first = firstParam(value);
    if (first) params.set(key, first);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  return text ? `${pathname}?${text}` : pathname;
}
