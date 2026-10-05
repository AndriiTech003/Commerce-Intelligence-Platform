import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { API_URL, TREND_STATS, env, loadProducts, num, storefrontHeaders, summarize, uuid } from './lib.js';

const POOL = num('PRODUCTS', 20);
const VUS = num('VUS', 200);
const DURATION = env('DURATION', '1m');

const created = new Counter('orders_created_201');
const conflicts = new Counter('checkout_conflict_409');
const serverErrors = new Counter('checkout_5xx');
const otherStatus = new Counter('checkout_other_status');
const cartFailures = new Counter('cart_add_failed');
const cartConflicts = new Counter('cart_conflict_409');
const replays = new Counter('idempotent_replays');
const checkoutDuration = new Trend('checkout_duration', true);

export const options = {
  summaryTrendStats: TREND_STATS,
  setupTimeout: '60s',
  scenarios: {
    buyers: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  thresholds: {
    'http_req_duration{scenario:buyers}': ['p(95)<5000'],
    'http_req_failed{scenario:buyers}': ['rate<0.01'],
    checkout_5xx: ['count==0'],
    orders_created_201: ['count>0'],
  },
};

export function setup() {
  const products = loadProducts(POOL);
  const variants = [];
  for (const product of products) {
    const res = http.get(`${API_URL}/v1/storefront/catalog/products/${product.slug}`, {
      headers: storefrontHeaders(uuid()),
      tags: { name: 'setup product' },
    });
    if (res.status !== 200) continue;
    for (const v of res.json().variants ?? []) if (v.available > 0) variants.push(v.id);
  }
  if (variants.length === 0) throw new Error('no purchasable variants in the product pool');
  return { variants };
}

export default function (ctx) {
  const anonymousId = uuid();
  const headers = storefrontHeaders(anonymousId, { 'content-type': 'application/json' });
  const variantId = ctx.variants[Math.floor(Math.random() * ctx.variants.length)];
  const cart = http.post(`${API_URL}/v1/storefront/cart/items`, JSON.stringify({ variantId, quantity: 1 }), {
    headers,
    tags: { name: 'POST /v1/storefront/cart/items' },
    responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 409),
  });
  if (cart.status !== 200 && cart.status !== 201) {
    cartFailures.add(1);
    if (cart.status === 409) cartConflicts.add(1);
    if (cart.status >= 500) serverErrors.add(1);
    return;
  }
  const key = `k6-${uuid()}`;
  const body = JSON.stringify({
    email: `k6-${anonymousId.slice(0, 8)}@load.dev`,
    shippingAddress: {
      name: 'Load Test',
      line1: 'Main 1',
      city: 'Berlin',
      postalCode: '10115',
      country: 'DE',
    },
    shippingMethod: 'standard',
  });
  const res = http.post(`${API_URL}/v1/storefront/checkout`, body, {
    headers: { ...headers, 'idempotency-key': key },
    tags: { name: 'POST /v1/storefront/checkout' },
    responseCallback: http.expectedStatuses(201, 409),
  });
  checkoutDuration.add(res.timings.duration);
  if (res.status === 201) created.add(1);
  else if (res.status === 409) conflicts.add(1);
  else if (res.status >= 500) serverErrors.add(1);
  else otherStatus.add(1, { status: String(res.status) });
  check(res, { 'checkout 201 or 409': (r) => r.status === 201 || r.status === 409 });
  if (res.status === 201 && Math.random() < num('REPLAY_SHARE', 0.05)) {
    const replay = http.post(`${API_URL}/v1/storefront/checkout`, body, {
      headers: { ...headers, 'idempotency-key': key },
      tags: { name: 'POST /v1/storefront/checkout (replay)' },
    });
    const same = replay.status === 201 && replay.json().orderId === res.json().orderId;
    if (same) replays.add(1);
    check(replay, { 'replay returns the same order': () => same });
  }
}

export function handleSummary(data) {
  const durationSeconds = (data.state?.testRunDurationMs ?? 0) / 1000;
  const count = (name) => data.metrics[name]?.values.count ?? 0;
  const orders = count('orders_created_201');
  const attempts =
    orders + count('checkout_conflict_409') + count('checkout_5xx') + count('checkout_other_status');
  return summarize(
    'checkout-contention',
    data,
    {
      vus: VUS,
      productPool: POOL,
      ordersPerSecond: durationSeconds ? Number((orders / durationSeconds).toFixed(2)) : 0,
      checkoutAttempts: attempts,
      status: {
        201: orders,
        409: count('checkout_conflict_409'),
        '5xx': count('checkout_5xx'),
        other: count('checkout_other_status'),
        cartFailed: count('cart_add_failed'),
        cart409: count('cart_conflict_409'),
      },
      conflictShare: attempts ? Number((count('checkout_conflict_409') / attempts).toFixed(4)) : 0,
      checkoutLatencyMs: {
        p50: data.metrics.checkout_duration?.values.med ?? null,
        p95: data.metrics.checkout_duration?.values['p(95)'] ?? null,
        p99: data.metrics.checkout_duration?.values['p(99)'] ?? null,
      },
    },
    'buyers',
  );
}
