import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
  API_URL,
  COLLECTOR_URL,
  TREND_STATS,
  env,
  loadProducts,
  num,
  productViewed,
  resolveContext,
  storefrontHeaders,
  summarize,
  uuid,
} from './lib.js';

const PROFILES = num('PROFILES', 2000);
const WARM_SHARE = num('WARM_SHARE', 0.3);
const PLACEMENT = env('PLACEMENT', 'home_hero');
const RATE = num('RATE', 100);
const DURATION = env('DURATION', '1m');

const served = new Counter('decisions_200');
const empty = new Counter('decisions_204');
const warmProfiles = new Counter('warm_profiles');

export const options = {
  summaryTrendStats: TREND_STATS,
  setupTimeout: '120s',
  scenarios: {
    decisions: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: num('PRE_VUS', 20),
      maxVUs: num('MAX_VUS', 300),
    },
  },
  thresholds: {
    'http_req_duration{name:GET /v1/storefront/decisions}': ['p(95)<50'],
    'http_req_failed{scenario:decisions}': ['rate<0.001'],
  },
};

export function setup() {
  const ids = Array.from({ length: PROFILES }, () => uuid());
  const warmCount = Math.floor(PROFILES * WARM_SHARE);
  if (warmCount > 0 && env('WARM', '1') === '1') {
    const ctx = resolveContext();
    const products = loadProducts(48);
    for (let i = 0; i < warmCount; i += 1) {
      const sessionId = uuid();
      const events = Array.from({ length: 5 }, () =>
        productViewed(ids[i], sessionId, products[Math.floor(Math.random() * products.length)]),
      );
      const res = http.post(`${COLLECTOR_URL}/v1/events`, JSON.stringify({ events }), {
        headers: { 'content-type': 'application/json', 'x-api-key': ctx.trackingKey },
        tags: { name: 'setup warm events' },
      });
      if (res.status === 202) warmProfiles.add(1);
    }
    sleep(num('WARM_WAIT_SECONDS', 5));
  }
  return { ids, warmCount };
}

export default function (ctx) {
  const index = Math.floor(Math.random() * ctx.ids.length);
  const res = http.get(`${API_URL}/v1/storefront/decisions?placement=${PLACEMENT}`, {
    headers: storefrontHeaders(ctx.ids[index]),
    tags: { name: 'GET /v1/storefront/decisions', warm: String(index < ctx.warmCount) },
  });
  if (res.status === 200) served.add(1);
  else if (res.status === 204) empty.add(1);
  check(res, { 'decision 200/204': (r) => r.status === 200 || r.status === 204 });
}

export function handleSummary(data) {
  const decision = data.metrics['http_req_duration{name:GET /v1/storefront/decisions}']?.values ?? {};
  return summarize(
    'decision-api',
    data,
    {
      placement: PLACEMENT,
      profiles: PROFILES,
      warmProfiles: data.setup_data?.warmCount ?? 0,
      decisionLatencyMs: { p50: decision.med, p95: decision['p(95)'], p99: decision['p(99)'] },
    },
    'decisions',
  );
}
