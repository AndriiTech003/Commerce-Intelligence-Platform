export const STORE_COOKIE = 'cip_store';
export const ANON_COOKIE = 'cip_aid';
export const STORE_HEADER = 'x-cip-store';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const RESERVED = new Set(['www', 'api', 'admin', 'app', 'localhost']);

export function isValidStoreSlug(value: string | null | undefined): value is string {
  return typeof value === 'string' && SLUG.test(value);
}

export function storeSlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (!hostname || hostname.startsWith('[') || IPV4.test(hostname)) return null;
  const labels = hostname.split('.').filter(Boolean);
  const isLocal = labels[labels.length - 1] === 'localhost';
  if (isLocal ? labels.length < 2 : labels.length < 3) return null;
  const candidate = labels[0];
  if (!candidate || RESERVED.has(candidate) || !isValidStoreSlug(candidate)) return null;
  return candidate;
}

export interface StoreResolutionInput {
  host?: string | null;
  query?: string | null;
  cookie?: string | null;
  fallback: string;
}

export interface StoreResolution {
  slug: string;
  source: 'host' | 'query' | 'cookie' | 'default';
}

export function resolveStoreSlug(input: StoreResolutionInput): StoreResolution {
  const fromHost = storeSlugFromHost(input.host);
  if (fromHost) return { slug: fromHost, source: 'host' };
  const query = input.query?.trim().toLowerCase();
  if (isValidStoreSlug(query)) return { slug: query, source: 'query' };
  const cookie = input.cookie?.trim().toLowerCase();
  if (isValidStoreSlug(cookie)) return { slug: cookie, source: 'cookie' };
  return { slug: input.fallback, source: 'default' };
}

export function defaultStore(): string {
  const value = process.env.DEFAULT_STORE?.trim().toLowerCase();
  return isValidStoreSlug(value) ? value : 'runhub';
}
