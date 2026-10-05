import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { createApp, type RunningApi } from '../../../src/app';
import { loadConfig, type ApiConfig } from '../../../src/config';
import type { TestResources } from './resources';

export function resources(): TestResources {
  return inject('resources');
}

export function testConfig(overrides: Record<string, string> = {}): ApiConfig {
  const r = resources();
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_PORT: '0',
    DATABASE_URL: r.databaseUrl,
    DATABASE_SYSTEM_URL: r.databaseSystemUrl,
    DATABASE_ADMIN_URL: r.databaseAdminUrl,
    DATABASE_POOL_SIZE: '30',
    REDIS_URL: r.redisUrl,
    REDIS_PREFIX: r.redisPrefix,
    RABBITMQ_URL: r.rabbitUrl,
    CLICKHOUSE_URL: r.clickhouseUrl,
    CLICKHOUSE_DATABASE: r.clickhouseDatabase,
    S3_ENDPOINT: r.s3Endpoint,
    S3_PUBLIC_URL: r.s3Endpoint,
    S3_KEY_PREFIX: r.s3KeyPrefix,
    SMTP_PORT: String(r.smtpPort),
    FAKE_PAYMENT_DELAY_MS: '50',
    STOREFRONT_RATE_LIMIT_PER_MIN: '100000',
    LOGIN_RATE_LIMIT: '5',
    ANALYTICS_CACHE_SECONDS: '0',
    CONSUMERS_ENABLED: 'false',
    ...overrides,
  });
}

export interface TestApi {
  api: RunningApi;
  url: string;
  config: ApiConfig;
  close(): Promise<void>;
}

export async function startApi(overrides: Record<string, string> = {}): Promise<TestApi> {
  const config = testConfig(overrides);
  const api = await createApp(config);
  config.INTERNAL_API_URL = api.url;
  return { api, url: api.url, config, close: () => api.close() };
}

export interface HttpResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function http<T = any>(
  base: string,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string | undefined>; raw?: string } = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.headers ?? {})) if (v !== undefined) headers[k] = v;
  if (options.body !== undefined || options.raw !== undefined) headers['content-type'] ??= 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T, headers: response.headers };
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomBytes(3).toString('hex')}`.slice(0, 32);
}

export interface Merchant {
  token: string;
  tenantId: string;
  userId: string;
  slug: string;
  email: string;
  refreshCookie: string;
  headers: Record<string, string>;
}

export function cookieValue(headers: Headers, name: string): string | null {
  for (const cookie of headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const [key, value] = (pair ?? '').split('=');
    if (key === name) return value ?? null;
  }
  return null;
}

export async function signupMerchant(base: string, prefix = 'shop', currency = 'USD'): Promise<Merchant> {
  const slug = uniqueSlug(prefix);
  const email = `${slug}@test.dev`;
  const res = await http(base, 'POST', '/v1/auth/signup', {
    body: {
      email,
      password: 'password123',
      name: 'Owner',
      storeName: `Store ${slug}`,
      storeSlug: slug,
      currency,
    },
  });
  if (res.status !== 201) throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
  const tenantId = res.body.memberships[0].tenantId as string;
  return {
    token: res.body.accessToken,
    tenantId,
    userId: res.body.user.id,
    slug,
    email,
    refreshCookie: cookieValue(res.headers, 'cip_rt') ?? '',
    headers: { authorization: `Bearer ${res.body.accessToken}`, 'x-tenant-id': tenantId },
  };
}

export async function createProduct(
  base: string,
  merchant: Merchant,
  input: {
    title?: string;
    variants?: Array<{ sku?: string; priceCents?: number; onHand?: number; title?: string }>;
    status?: string;
  } = {},
) {
  const res = await http(base, 'POST', '/v1/admin/products', {
    headers: merchant.headers,
    body: {
      title: input.title ?? `Product ${randomBytes(3).toString('hex')}`,
      status: input.status ?? 'active',
      description: 'Test product',
      variants: (input.variants ?? [{}]).map((v, i) => ({
        sku: v.sku ?? `SKU-${randomBytes(4).toString('hex')}-${i}`,
        title: v.title ?? `Variant ${i}`,
        priceCents: v.priceCents ?? 1000,
        onHand: v.onHand ?? 10,
      })),
    },
  });
  if (res.status !== 201) throw new Error(`create product failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as {
    id: string;
    slug: string;
    version: string;
    variants: Array<{ id: string; sku: string; priceCents: number }>;
  };
}

export class Shopper {
  readonly anonymousId = uuidv7();
  token: string | null = null;

  constructor(
    private readonly base: string,
    readonly store: string,
  ) {}

  headers(extra: Record<string, string | undefined> = {}) {
    return {
      'x-store': this.store,
      'x-anonymous-id': this.anonymousId,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string | undefined> = {},
  ) {
    return http<T>(this.base, method, path, { body, headers: this.headers(extra) });
  }

  addItem(variantId: string, quantity = 1) {
    return this.request('POST', '/v1/storefront/cart/items', { variantId, quantity });
  }

  checkout(key: string, overrides: Record<string, unknown> = {}) {
    return this.request(
      'POST',
      '/v1/storefront/checkout',
      {
        email: `${this.anonymousId.slice(0, 8)}@buyer.dev`,
        shippingAddress: {
          name: 'Buyer',
          line1: 'Main 1',
          city: 'Berlin',
          postalCode: '10115',
          country: 'DE',
        },
        shippingMethod: 'standard',
        ...overrides,
      },
      { 'idempotency-key': key },
    );
  }
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 10000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out${last ? `: ${String(last)}` : ''}`);
}

export async function mailpitMessages(to: string): Promise<Array<{ ID: string; Subject: string }>> {
  const r = resources();
  const response = await fetch(`${r.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  const body = (await response.json()) as { messages: Array<{ ID: string; Subject: string }> };
  return body.messages ?? [];
}

export async function mailpitText(id: string): Promise<string> {
  const r = resources();
  const response = await fetch(`${r.mailpitUrl}/api/v1/message/${id}`);
  const body = (await response.json()) as { Text: string };
  return body.Text;
}
