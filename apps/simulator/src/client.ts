import { counter, histogram } from '@cip/observability';
import type { CatalogProduct } from './behaviour';

const httpCalls = counter('simulator_http_requests_total', 'Simulator HTTP calls', ['target', 'status']);
const httpSeconds = histogram(
  'simulator_http_seconds',
  'Simulator HTTP latency',
  ['target'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
);

export interface Visitor {
  anonymousId: string;
  personaKey: string;
  customerId: string | null;
  token: string | null;
  email: string | null;
  sessions: number;
}

export interface DecisionResponse {
  decisionId: string;
  placement: string;
  campaignId: string;
  creativeId: string;
  segmentKey: string;
  policy: string;
  creative: { headline: string; body: string; cta: string; tone: string | null };
  products: Array<{
    id: string;
    slug: string;
    categoryPath: string | null;
    priceMinCents: number | null;
    title: string;
  }>;
}

export interface StoreInfo {
  id: string;
  slug: string;
  trackingKey: string;
  currency: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class StoreClient {
  info: StoreInfo | null = null;
  products: CatalogProduct[] = [];
  private readonly details = new Map<
    string,
    Promise<{ variants: Array<{ id: string; available: number; priceCents: number }> } | null>
  >();

  constructor(
    readonly apiUrl: string,
    readonly collectorUrl: string,
    readonly slug: string,
  ) {}

  headers(visitor: Visitor | null, extra: Record<string, string> = {}): Record<string, string> {
    return {
      'x-store': this.slug,
      'user-agent': 'cip-simulator',
      ...(visitor ? { 'x-anonymous-id': visitor.anonymousId } : {}),
      ...(visitor?.token ? { authorization: `Bearer ${visitor.token}` } : {}),
      ...extra,
    };
  }

  async request<T>(
    target: string,
    method: string,
    path: string,
    visitor: Visitor | null,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const timer = httpSeconds.startTimer({ target });
    try {
      const response = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: this.headers(
          visitor,
          body === undefined ? extra : { 'content-type': 'application/json', ...extra },
        ),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      httpCalls.inc({ target, status: String(response.status) });
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
    } finally {
      timer();
    }
  }

  async load(maxProducts = 300): Promise<boolean> {
    const info = await this.request<{ id: string; trackingKey: string | null; currency: string }>(
      'store',
      'GET',
      '/v1/storefront/store',
      null,
    );
    if (info.status !== 200 || !info.body.trackingKey) return false;
    this.info = {
      id: info.body.id,
      slug: this.slug,
      trackingKey: info.body.trackingKey,
      currency: info.body.currency,
    };
    const products: CatalogProduct[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20 && products.length < maxProducts; page++) {
      const query: URLSearchParams = new URLSearchParams({ limit: '60', ...(cursor ? { cursor } : {}) });
      const res: { status: number; body: { data: CatalogProduct[]; nextCursor: string | null } } =
        await this.request<{ data: CatalogProduct[]; nextCursor: string | null }>(
          'catalog',
          'GET',
          `/v1/storefront/catalog/products?${query}`,
          null,
        );
      if (res.status !== 200) break;
      products.push(...res.body.data);
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    this.products = products;
    return products.length > 0;
  }

  async decision(visitor: Visitor, placement: string, productId?: string): Promise<DecisionResponse | null> {
    const query = new URLSearchParams({ placement, ...(productId ? { productId } : {}) });
    const res = await this.request<DecisionResponse>(
      'decision',
      'GET',
      `/v1/storefront/decisions?${query}`,
      visitor,
    );
    return res.status === 200 ? res.body : null;
  }

  async explanation(visitor: Visitor, decisionId: string) {
    const res = await this.request<{ creative?: { arms?: Array<{ id: string; tone: string | null }> } }>(
      'explanation',
      'GET',
      `/v1/storefront/decisions/${decisionId}/explanation`,
      visitor,
    );
    return res.status === 200 ? (res.body.creative?.arms ?? []) : [];
  }

  detail(slug: string) {
    let pending = this.details.get(slug);
    if (!pending) {
      pending = this.request<{ variants: Array<{ id: string; available: number; priceCents: number }> }>(
        'product',
        'GET',
        `/v1/storefront/catalog/products/${slug}`,
        null,
      ).then((r) => (r.status === 200 ? r.body : null));
      this.details.set(slug, pending);
      if (this.details.size > 2000) this.details.clear();
    }
    return pending;
  }

  addToCart(visitor: Visitor, variantId: string) {
    return this.request('cart', 'POST', '/v1/storefront/cart/items', visitor, { variantId, quantity: 1 });
  }

  applyDiscount(visitor: Visitor, code: string) {
    return this.request('cart', 'POST', '/v1/storefront/cart/discount', visitor, { code });
  }

  checkout(visitor: Visitor, email: string, key: string) {
    return this.request<{
      orderId: string;
      number: number;
      totalCents: number;
      payment: { intentId: string };
    }>(
      'checkout',
      'POST',
      '/v1/storefront/checkout',
      visitor,
      {
        email,
        shippingAddress: {
          name: 'Sim Shopper',
          line1: 'Main 1',
          city: 'Berlin',
          postalCode: '10115',
          country: 'DE',
        },
        shippingMethod: 'standard',
      },
      { 'idempotency-key': key },
    );
  }

  confirm(visitor: Visitor, intentId: string) {
    return this.request('payment', 'POST', `/v1/payments/fake/${intentId}/confirm`, visitor, {
      cardNumber: '4242424242424242',
    });
  }

  register(visitor: Visitor, email: string) {
    return this.request<{ accessToken: string; customer: { id: string } }>(
      'auth',
      'POST',
      '/v1/storefront/auth/register',
      visitor,
      {
        email,
        password: 'simulated-pass-1',
        name: 'Simulated Shopper',
      },
    );
  }

  async send(events: unknown[]): Promise<number> {
    if (!this.info || events.length === 0) return 0;
    let sent = 0;
    for (let offset = 0; offset < events.length; offset += 50) {
      const batch = events.slice(offset, offset + 50);
      const timer = httpSeconds.startTimer({ target: 'collector' });
      const response = await fetch(`${this.collectorUrl}/v1/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.info.trackingKey,
          'user-agent': 'cip-simulator',
        },
        body: JSON.stringify({ events: batch }),
      }).finally(() => timer());
      httpCalls.inc({ target: 'collector', status: String(response.status) });
      await response.arrayBuffer().catch(() => undefined);
      if (response.status === 202) sent += batch.length;
      else if (response.status >= 500 || response.status === 429)
        throw new HttpError(response.status, 'collector unavailable');
    }
    return sent;
  }
}
