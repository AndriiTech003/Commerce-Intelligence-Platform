import http from 'k6/http';

export const TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'];

export function env(name, fallback) {
  const value = __ENV[name];
  return value === undefined || value === '' ? fallback : value;
}

export function num(name, fallback) {
  const value = Number(env(name, ''));
  return Number.isFinite(value) && env(name, '') !== '' ? value : fallback;
}

export const API_URL = env('API_URL', 'http://127.0.0.1:4100');
export const COLLECTOR_URL = env('COLLECTOR_URL', 'http://127.0.0.1:4110');
export const STORE = env('STORE', 'runhub');

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function storefrontHeaders(anonymousId, extra = {}) {
  return { 'x-store': STORE, 'x-anonymous-id': anonymousId, ...extra };
}

export function resolveContext() {
  const trackingKey = env('TRACKING_KEY', '');
  if (trackingKey && env('TENANT_ID', '')) return { trackingKey, tenantId: env('TENANT_ID') };
  const login = http.post(
    `${API_URL}/v1/auth/login`,
    JSON.stringify({
      email: env('OWNER_EMAIL', `owner@${STORE}.dev`),
      password: env('OWNER_PASSWORD', 'demo1234'),
    }),
    { headers: { 'content-type': 'application/json' }, tags: { name: 'setup login' } },
  );
  if (login.status !== 200) {
    if (trackingKey) return { trackingKey, tenantId: env('TENANT_ID', '') };
    throw new Error(`login for ${STORE} failed with ${login.status}; set TRACKING_KEY`);
  }
  const body = login.json();
  const membership = body.memberships.find((m) => m.slug === STORE) ?? body.memberships[0];
  if (trackingKey) return { trackingKey, tenantId: membership.tenantId };
  const settings = http.get(`${API_URL}/v1/admin/settings`, {
    headers: { authorization: `Bearer ${body.accessToken}`, 'x-tenant-id': membership.tenantId },
    tags: { name: 'setup settings' },
  });
  if (settings.status !== 200) throw new Error(`GET /v1/admin/settings returned ${settings.status}`);
  return { trackingKey: settings.json().trackingKey, tenantId: membership.tenantId };
}

export function loadProducts(limit = 24) {
  const products = [];
  let cursor = '';
  while (products.length < limit) {
    const page = http.get(
      `${API_URL}/v1/storefront/catalog/products?limit=${Math.min(48, limit)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { headers: storefrontHeaders(uuid()), tags: { name: 'setup catalog' } },
    );
    if (page.status !== 200) throw new Error(`catalog list returned ${page.status}`);
    const body = page.json();
    for (const p of body.data)
      if (p.available !== false)
        products.push({
          id: p.id,
          slug: p.slug,
          categoryPath: p.categoryPath ?? '',
          priceCents: p.priceMinCents,
        });
    cursor = body.nextCursor ?? body.next_cursor ?? '';
    if (!cursor || body.data.length === 0) break;
  }
  return products.slice(0, limit);
}

export function pageViewed(anonymousId, sessionId) {
  return {
    event_id: uuid(),
    event_type: 'page_viewed',
    occurred_at: new Date().toISOString(),
    anonymous_id: anonymousId,
    session_id: sessionId,
    properties: { page_type: 'home' },
  };
}

export function productViewed(anonymousId, sessionId, product) {
  return {
    event_id: uuid(),
    event_type: 'product_viewed',
    occurred_at: new Date().toISOString(),
    anonymous_id: anonymousId,
    session_id: sessionId,
    properties: {
      product_id: product.id,
      category_path: product.categoryPath ?? '',
      price_cents: product.priceCents ?? 5000,
    },
  };
}

export function parseHistogram(text, name, labelFilter) {
  const buckets = new Map();
  let sum = 0;
  let count = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    const match = /^([a-z_]+)\{([^}]*)\}\s+([0-9.eE+-]+|NaN|\+Inf)$/.exec(line);
    if (!match) continue;
    const [, metric, rawLabels, rawValue] = match;
    const labels = {};
    for (const part of rawLabels.match(/[a-z_]+="[^"]*"/g) ?? []) {
      const [k, v] = part.split('=');
      labels[k] = v.slice(1, -1);
    }
    if (!Object.entries(labelFilter).every(([k, v]) => labels[k] === v)) continue;
    const value = Number(rawValue);
    if (metric === `${name}_bucket`) {
      buckets.set(labels.le, (buckets.get(labels.le) ?? 0) + value);
    } else if (metric === `${name}_sum`) sum += value;
    else if (metric === `${name}_count`) count += value;
  }
  const order = (le) => (le === '+Inf' ? Infinity : Number(le));
  return { buckets: [...buckets.entries()].sort((a, b) => order(a[0]) - order(b[0])), sum, count };
}

export function diffHistogram(after, before) {
  const prior = new Map(before?.buckets ?? []);
  return {
    buckets: after.buckets.map(([le, value]) => [le, value - (prior.get(le) ?? 0)]),
    sum: after.sum - (before?.sum ?? 0),
    count: after.count - (before?.count ?? 0),
  };
}

export function histogramQuantile(q, histogram) {
  const { buckets, count } = histogram;
  if (!count || buckets.length === 0) return NaN;
  const rank = q * count;
  let prevLe = 0;
  let prevCount = 0;
  for (const [label, cumulative] of buckets) {
    const le = label === '+Inf' ? Infinity : Number(label);
    if (cumulative >= rank) {
      if (le === Infinity) return prevLe;
      const inBucket = cumulative - prevCount;
      return inBucket <= 0 ? le : prevLe + ((le - prevLe) * (rank - prevCount)) / inBucket;
    }
    prevLe = le;
    prevCount = cumulative;
  }
  return prevLe;
}

function fmt(value, unit) {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  if (unit === 'ms') return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
  if (unit === '%') return `${(value * 100).toFixed(2)} %`;
  if (unit === '/s') return `${value.toFixed(1)}/s`;
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function summarize(scenario, data, extra = {}, executor = scenario) {
  const m = data.metrics;
  const duration = (m[`http_req_duration{scenario:${executor}}`] ?? m.http_req_duration)?.values ?? {};
  const failed = (m[`http_req_failed{scenario:${executor}}`] ?? m.http_req_failed)?.values ?? {};
  const durationSeconds = (data.state?.testRunDurationMs ?? 0) / 1000;
  const result = {
    scenario,
    finishedAt: new Date().toISOString(),
    durationSeconds,
    requests: m.http_reqs?.values.count ?? 0,
    rps: m.http_reqs?.values.rate ?? 0,
    latencyMs: {
      p50: duration.med,
      p90: duration['p(90)'],
      p95: duration['p(95)'],
      p99: duration['p(99)'],
      max: duration.max,
    },
    errorRate: failed.rate ?? 0,
    checks: m.checks ? { passes: m.checks.values.passes, fails: m.checks.values.fails } : null,
    thresholds: Object.fromEntries(
      Object.entries(m)
        .filter(([, v]) => v.thresholds)
        .map(([k, v]) => [k, Object.fromEntries(Object.entries(v.thresholds).map(([t, r]) => [t, r.ok]))]),
    ),
    custom: Object.fromEntries(
      Object.entries(m)
        .filter(
          ([k]) =>
            !k.startsWith('http_') &&
            !k.includes('{') &&
            ![
              'iterations',
              'iteration_duration',
              'vus',
              'vus_max',
              'data_received',
              'data_sent',
              'checks',
              'dropped_iterations',
            ].includes(k),
        )
        .map(([k, v]) => [k, v.values]),
    ),
    droppedIterations: m.dropped_iterations?.values.count ?? 0,
    ...extra,
  };
  const failedThresholds = Object.entries(result.thresholds).flatMap(([metric, t]) =>
    Object.entries(t)
      .filter(([, ok]) => !ok)
      .map(([expr]) => `${metric} ${expr}`),
  );
  result.passed = failedThresholds.length === 0;
  const lines = [
    `scenario     ${scenario}`,
    `duration     ${durationSeconds.toFixed(1)} s, ${result.requests} requests, ${fmt(result.rps, '/s')}, dropped iterations ${result.droppedIterations}`,
    `latency      p50 ${fmt(duration.med, 'ms')}  p95 ${fmt(duration['p(95)'], 'ms')}  p99 ${fmt(duration['p(99)'], 'ms')}  max ${fmt(duration.max, 'ms')}`,
    `errors       ${fmt(result.errorRate, '%')}${result.checks ? `  checks ${result.checks.passes} ok / ${result.checks.fails} failed` : ''}`,
  ];
  for (const [name, values] of Object.entries(result.custom)) {
    const shown = Object.entries(values)
      .filter(([k]) => ['count', 'rate', 'value', 'med', 'p(95)', 'p(99)', 'max'].includes(k))
      .map(([k, v]) => `${k}=${fmt(v)}`)
      .join(' ');
    lines.push(`${name.padEnd(12)} ${shown}`);
  }
  for (const [key, value] of Object.entries(extra))
    lines.push(`${key.padEnd(12)} ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  lines.push(`thresholds   ${result.passed ? 'all passed' : `FAILED: ${failedThresholds.join('; ')}`}`);
  const out = { stdout: `\n${lines.join('\n')}\n\n` };
  const path = env('SUMMARY', '');
  if (path) out[path] = JSON.stringify(result, null, 2);
  return out;
}
