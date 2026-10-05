import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const profile = args.find((a) => !a.startsWith('--')) ?? 'smoke';
const JAEGER = process.env.JAEGER_URL ?? 'http://127.0.0.1:4193';
const OUT = process.env.TRACE_OUT_DIR ?? join(root, 'docs', 'assets');
const STORE = process.env.STORE ?? 'runhub';
const TIMEOUT_MS = Number(process.env.TRACE_TIMEOUT_MS ?? 30000);
const REQUIRED_SERVICES = (process.env.TRACE_REQUIRED_SERVICES ?? 'api,domain-worker').split(',');
const REQUIRED_DB_SYSTEMS = (process.env.TRACE_REQUIRED_DB_SYSTEMS ?? 'postgresql,redis')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function dbSystems(trace) {
  const counts = {};
  for (const span of trace.spans) {
    const tag = span.tags?.find((t) => t.key === 'db.system' || t.key === 'db.system.name');
    if (!tag) continue;
    const service = trace.processes[span.processID]?.serviceName ?? 'unknown';
    const key = `${tag.value}`;
    counts[key] ??= { spans: 0, services: new Set(), operations: new Set() };
    counts[key].spans += 1;
    counts[key].services.add(service);
    counts[key].operations.add(span.operationName);
  }
  return counts;
}

function log(message) {
  process.stdout.write(`capture-trace: ${message}\n`);
}

function die(message) {
  process.stderr.write(`capture-trace: ${message}\n`);
  process.exit(1);
}

async function request(base, method, path, { body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, body: data, headers: response.headers };
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn().catch(() => null);
    if (last?.done) return last.value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}${last?.reason ? ` (${last.reason})` : ''}`);
}

function traceIdFrom(traceparent) {
  const match = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(traceparent ?? '');
  return match?.[1] ?? null;
}

export function spanTree(trace) {
  const services = Object.fromEntries(Object.entries(trace.processes).map(([id, p]) => [id, p.serviceName]));
  const byId = new Map(trace.spans.map((s) => [s.spanID, s]));
  const children = new Map();
  const roots = [];
  for (const span of trace.spans) {
    const parent = (span.references ?? []).find((r) => byId.has(r.spanID));
    if (parent) {
      if (!children.has(parent.spanID)) children.set(parent.spanID, []);
      children.get(parent.spanID).push(span);
    } else roots.push(span);
  }
  const start = Math.min(...trace.spans.map((s) => s.startTime));
  const lines = [];
  const visit = (span, depth) => {
    const ref = (span.references ?? []).find((r) => byId.has(r.spanID));
    const kind = span.tags?.find((t) => t.key === 'span.kind')?.value;
    const offset = ((span.startTime - start) / 1000).toFixed(1);
    const duration = (span.duration / 1000).toFixed(1);
    lines.push(
      `${'  '.repeat(depth)}${services[span.processID]}: ${span.operationName} (${duration} ms, +${offset} ms${kind ? `, ${kind}` : ''}${ref?.refType === 'FOLLOWS_FROM' ? ', follows' : ''})`,
    );
    for (const child of (children.get(span.spanID) ?? []).sort((a, b) => a.startTime - b.startTime))
      visit(child, depth + 1);
  };
  for (const span of roots.sort((a, b) => a.startTime - b.startTime)) visit(span, 0);
  return { lines, services: [...new Set(Object.values(services))], spanCount: trace.spans.length };
}

async function fetchTrace(traceId) {
  const res = await request(JAEGER, 'GET', `/api/traces/${traceId}`);
  if (res.status !== 200) return null;
  return res.body?.data?.[0] ?? null;
}

async function placeOrder(api) {
  const headers = { 'x-store': STORE, 'x-anonymous-id': randomUUID() };
  const list = await request(api, 'GET', '/v1/storefront/catalog/products?limit=24', { headers });
  if (list.status !== 200) throw new Error(`catalog list returned ${list.status}`);
  let variant = null;
  for (const item of list.body.data.filter((p) => p.available)) {
    const product = await request(api, 'GET', `/v1/storefront/catalog/products/${item.slug}`, { headers });
    variant = product.body?.variants?.find((v) => v.available > 0) ?? null;
    if (variant) break;
  }
  if (!variant) throw new Error(`no purchasable variant in ${STORE}`);
  const cart = await request(api, 'POST', '/v1/storefront/cart/items', {
    headers,
    body: { variantId: variant.id, quantity: 1 },
  });
  if (cart.status >= 300) throw new Error(`add to cart returned ${cart.status}`);
  const email = `trace-${randomUUID().slice(0, 8)}@buyer.dev`;
  const checkout = await request(api, 'POST', '/v1/storefront/checkout', {
    headers: { ...headers, 'idempotency-key': `trace-${randomUUID()}` },
    body: {
      email,
      shippingAddress: {
        name: 'Trace Buyer',
        line1: 'Main 1',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
      },
      shippingMethod: 'standard',
    },
  });
  if (checkout.status !== 201)
    throw new Error(`checkout returned ${checkout.status}: ${JSON.stringify(checkout.body)}`);
  const traceparent = checkout.headers.get('traceparent');
  log(`order #${checkout.body.number} (${checkout.body.orderId}), traceparent ${traceparent}`);
  const confirmStarted = Date.now();
  const confirm = await request(api, 'POST', `/v1/payments/fake/${checkout.body.payment.intentId}/confirm`, {
    headers,
    body: { cardNumber: '4242424242424242' },
  });
  if (confirm.status !== 202) throw new Error(`payment confirm returned ${confirm.status}`);
  await waitFor(
    async () => {
      const order = await request(api, 'GET', `/v1/storefront/orders/${checkout.body.orderId}`, { headers });
      return { done: order.body?.status === 'paid', reason: `status ${order.body?.status}` };
    },
    TIMEOUT_MS,
    'order to become paid',
  );
  log('order is paid (signed fake webhook processed)');
  return {
    traceparent,
    orderId: checkout.body.orderId,
    confirmStarted,
    confirmTraceparent: confirm.headers.get('traceparent'),
  };
}

async function findWebhookTrace(since) {
  const params = new URLSearchParams({
    service: 'api',
    operation: 'POST /v1/payments/webhooks/fake',
    start: String(since * 1000),
    end: String((Date.now() + 1000) * 1000),
    limit: '5',
  });
  const res = await request(JAEGER, 'GET', `/api/traces?${params}`);
  const traces = (res.body?.data ?? []).sort(
    (a, b) => Math.min(...a.spans.map((s) => s.startTime)) - Math.min(...b.spans.map((s) => s.startTime)),
  );
  return traces[0] ?? null;
}

function write(name, trace, tree, header) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify({ data: [trace] }, null, 2)}\n`);
  const text = [
    ...header,
    `services: ${tree.services.join(', ')}`,
    `spans: ${tree.spanCount}`,
    '',
    ...tree.lines,
    '',
  ].join('\n');
  writeFileSync(join(OUT, `${name}.txt`), text);
  log(`wrote ${join(OUT, `${name}.json`)} and .txt`);
}

export async function screenshot(traceId, file, spanCount = 20) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const height = Math.min(4000, Math.max(500, 340 + spanCount * 36));
    const page = await browser.newPage({ viewport: { width: 1600, height }, deviceScaleFactor: 2 });
    await page.goto(`${JAEGER}/trace/${traceId}`, { waitUntil: 'networkidle' });
    await page
      .getByText('domain-worker')
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => undefined);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: file });
    log(`wrote ${file}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const stackFile = join(root, '.smoke', `${profile}.json`);
  if (!existsSync(stackFile))
    die(
      `${stackFile} not found; start the stack with OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4194 node scripts/stack.mjs ${profile}`,
    );
  const stack = JSON.parse(readFileSync(stackFile, 'utf8'));
  const api = `http://127.0.0.1:${stack.ports.api}`;
  const services = await request(JAEGER, 'GET', '/api/v3/services').catch(() => null);
  if (services?.status !== 200)
    die(`Jaeger query API not reachable at ${JAEGER} (scripts/observability.sh start)`);

  const order = await placeOrder(api);
  const traceId = traceIdFrom(order.traceparent);
  if (!traceId) die(`checkout response has no valid traceparent header (${order.traceparent})`);

  const trace = await waitFor(
    async () => {
      const t = await fetchTrace(traceId);
      if (!t) return { done: false, reason: 'trace not in Jaeger yet' };
      const tree = spanTree(t);
      const missing = REQUIRED_SERVICES.filter((s) => !tree.services.includes(s));
      return missing.length === 0
        ? { done: true, value: t }
        : { done: false, reason: `have ${tree.services.join(', ')}, missing ${missing.join(', ')}` };
    },
    TIMEOUT_MS,
    `trace ${traceId} with spans from ${REQUIRED_SERVICES.join(' + ')}`,
  ).catch((error) =>
    die(
      `${error.message}. Are the services exporting OTLP (OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4194)?`,
    ),
  );
  await new Promise((r) => setTimeout(r, Number(process.env.TRACE_SETTLE_MS ?? 3000)));
  const settled = (await fetchTrace(traceId)) ?? trace;
  const tree = spanTree(settled);
  write('trace-checkout', settled, tree, [
    `trace ${traceId}`,
    `POST /v1/storefront/checkout on the ${profile} stack, order ${order.orderId}`,
    `captured ${new Date().toISOString()} from ${JAEGER}/trace/${traceId}`,
  ]);
  process.stdout.write(`\n${tree.lines.join('\n')}\n\n`);

  const operations = new Set(
    settled.spans.map((s) => `${settled.processes[s.processID].serviceName}: ${s.operationName}`),
  );
  const relay = [...operations].some((o) => o.startsWith('domain-worker:') && /outbox|publish/i.test(o));
  const notifications = [...operations].some((o) => o.includes('q.notifications'));
  log(
    `services: ${tree.services.join(', ')}; outbox relay span: ${relay ? 'yes' : 'no'}; notifications consumer span: ${notifications ? 'yes' : 'no'}`,
  );

  const webhook = await findWebhookTrace(order.confirmStarted).catch(() => null);
  if (webhook) {
    const webhookTree = spanTree(webhook);
    write('trace-payment-webhook', webhook, webhookTree, [
      `trace ${webhook.traceID}`,
      'POST /v1/payments/webhooks/fake (signed fake webhook → order.paid outbox → relay → notifications email)',
      `captured ${new Date().toISOString()}`,
    ]);
  } else log('payment webhook trace not found (optional)');

  if (flags.has('--screenshot')) {
    await screenshot(traceId, join(OUT, 'trace-checkout.png'), tree.spanCount);
    if (webhook)
      await screenshot(webhook.traceID, join(OUT, 'trace-payment-webhook.png'), webhook.spans.length);
  }
  const systems = dbSystems(settled);
  for (const [system, info] of Object.entries(systems))
    log(
      `${system}: ${info.spans} spans from ${[...info.services].join(', ')} (${[...info.operations].slice(0, 6).join(', ')}${info.operations.size > 6 ? ', …' : ''})`,
    );
  const missingDb = REQUIRED_DB_SYSTEMS.filter((s) => !systems[s]);
  if (missingDb.length > 0) log(`missing auto-instrumented spans: ${missingDb.join(', ')}`);
  const ok = REQUIRED_SERVICES.every((s) => tree.services.includes(s)) && relay && missingDb.length === 0;
  log(
    ok
      ? `PASS: checkout trace spans api + domain-worker (outbox relay) with ${REQUIRED_DB_SYSTEMS.join(' + ')} spans`
      : 'FAIL: required spans missing',
  );
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => die(error instanceof Error ? error.message : String(error)));
}
