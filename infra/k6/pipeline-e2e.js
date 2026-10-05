import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Gauge } from 'k6/metrics';
import {
  COLLECTOR_URL,
  TREND_STATS,
  diffHistogram,
  env,
  histogramQuantile,
  loadProducts,
  num,
  pageViewed,
  parseHistogram,
  productViewed,
  resolveContext,
  summarize,
  uuid,
} from './lib.js';

const BATCH = num('BATCH', 20);
const RATE = num('RATE', 50);
const DURATION = env('DURATION', '2m');
const DRAIN_SECONDS = num('DRAIN_SECONDS', 10);
const QUEUE = env('QUEUE', 'q.analytics.ingest');
const STREAM_METRICS_URL = env('STREAM_METRICS_URL', 'http://127.0.0.1:4150/metrics');
const PROMETHEUS_URL = env('PROMETHEUS_URL', '');
const MIX = env('EVENT_MIX', 'page');
const RETRIES = num('RETRIES', 0);

const accepted = new Counter('events_accepted');
const limited = new Counter('rate_limited_429');
const unavailable = new Counter('unavailable_503');
const retried = new Counter('batches_retried');
const lost = new Counter('batches_lost');
const p50 = new Gauge('freshness_p50_seconds');
const p95 = new Gauge('freshness_p95_seconds');
const p99 = new Gauge('freshness_p99_seconds');
const observed = new Gauge('freshness_observations');
const promP95 = new Gauge('freshness_p95_prometheus_seconds');

export const options = {
  summaryTrendStats: TREND_STATS,
  setupTimeout: '60s',
  teardownTimeout: `${DRAIN_SECONDS + 60}s`,
  scenarios: {
    constant: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: num('PRE_VUS', 20),
      maxVUs: num('MAX_VUS', 200),
    },
  },
  thresholds: {
    'http_req_duration{scenario:constant}': ['p(95)<1000'],
    'http_req_failed{scenario:constant}': ['rate<0.001'],
    freshness_p95_seconds: [`value<${num('FRESHNESS_P95_TARGET', 2)}`],
  },
};

function snapshot() {
  const res = http.get(STREAM_METRICS_URL, { tags: { name: 'stream-worker metrics' } });
  if (res.status !== 200) return null;
  return parseHistogram(res.body, 'message_end_to_end_seconds', { queue: QUEUE });
}

export function setup() {
  const ctx = resolveContext();
  return {
    ...ctx,
    runId: env('RUN_ID', uuid()),
    products: MIX === 'product' ? loadProducts(48) : [],
    baseline: snapshot(),
    startedAt: Date.now(),
  };
}

export default function (ctx) {
  const anonymousId = uuid();
  const events = Array.from({ length: BATCH }, (_, i) =>
    MIX === 'product' && ctx.products.length && i % 2 === 0
      ? productViewed(anonymousId, ctx.runId, ctx.products[Math.floor(Math.random() * ctx.products.length)])
      : pageViewed(anonymousId, ctx.runId),
  );
  const payload = JSON.stringify({ events });
  let res = null;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0) {
      retried.add(1);
      sleep(Math.min(8, 0.5 * 2 ** (attempt - 1)) * (0.5 + Math.random()));
    }
    res = http.post(`${COLLECTOR_URL}/v1/events`, payload, {
      headers: { 'content-type': 'application/json', 'x-api-key': ctx.trackingKey },
      tags: { name: 'POST /v1/events', attempt: attempt === 0 ? 'first' : 'retry' },
    });
    if (res.status === 202) break;
    if (res.status === 429) limited.add(1);
    else if (res.status === 503) unavailable.add(1);
    if (res.status !== 0 && res.status !== 429 && res.status < 500) break;
  }
  if (res.status === 202) accepted.add(res.json().accepted);
  else lost.add(1);
  check(res, { accepted: (r) => r.status === 202 });
}

export function teardown(ctx) {
  sleep(DRAIN_SECONDS);
  const after = snapshot();
  if (after) {
    const delta = diffHistogram(after, ctx.baseline);
    observed.add(delta.count);
    p50.add(histogramQuantile(0.5, delta));
    p95.add(histogramQuantile(0.95, delta));
    p99.add(histogramQuantile(0.99, delta));
  }
  if (PROMETHEUS_URL) {
    const window = Math.max(60, Math.ceil((Date.now() - ctx.startedAt) / 1000));
    const query = `histogram_quantile(0.95, sum by (le) (increase(message_end_to_end_seconds_bucket{queue="${QUEUE}"}[${window}s])))`;
    const res = http.get(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`, {
      tags: { name: 'prometheus query' },
    });
    const value = res.status === 200 ? Number(res.json().data.result[0]?.value[1]) : NaN;
    if (Number.isFinite(value)) promP95.add(value);
  }
}

export function handleSummary(data) {
  const durationSeconds = (data.state?.testRunDurationMs ?? 0) / 1000;
  const events = data.metrics.events_accepted?.values.count ?? 0;
  return summarize(
    'pipeline-e2e',
    data,
    {
      queue: QUEUE,
      targetEventsPerSecond: RATE * BATCH,
      eventsAccepted: events,
      retries: RETRIES,
      batchesLost: data.metrics.batches_lost?.values.count ?? 0,
      eventsPerSecondAvg: durationSeconds ? Math.round(events / (durationSeconds - DRAIN_SECONDS)) : 0,
      freshnessSeconds: {
        p50: data.metrics.freshness_p50_seconds?.values.value ?? null,
        p95: data.metrics.freshness_p95_seconds?.values.value ?? null,
        p99: data.metrics.freshness_p99_seconds?.values.value ?? null,
        observations: data.metrics.freshness_observations?.values.value ?? null,
        p95FromPrometheus: data.metrics.freshness_p95_prometheus_seconds?.values.value ?? null,
      },
      runId: data.setup_data?.runId ?? null,
      tenantId: data.setup_data?.tenantId ?? null,
    },
    'constant',
  );
}
