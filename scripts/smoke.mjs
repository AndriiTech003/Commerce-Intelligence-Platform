import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import WebSocket from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stack = JSON.parse(readFileSync(join(root, '.smoke', `${process.argv[2] ?? 'smoke'}.json`), 'utf8'));
const { env, ports } = stack;
const api = `http://127.0.0.1:${ports.api}`;
const storefront = `http://127.0.0.1:${ports.storefront}`;
const admin = `http://127.0.0.1:${ports.admin}`;
let checks = 0;

function ok(condition, message) {
  if (!condition) throw new Error(`smoke check failed: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

async function json(base, method, path, { body, headers = {} } = {}) {
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
  while (Date.now() < deadline) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function clickhouse(sql) {
  const url = new URL(env.CLICKHOUSE_URL);
  url.searchParams.set('database', env.CLICKHOUSE_DATABASE);
  const response = await fetch(url, { method: 'POST', body: `${sql} FORMAT JSONEachRow` });
  const text = await response.text();
  return text.trim()
    ? text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

console.log('smoke: health');
for (const [name, port] of Object.entries({
  api: ports.api,
  collector: ports.collector,
  gateway: ports.gateway,
  stream: ports.stream,
  domain: ports.domain,
  simulator: ports.simulator,
})) {
  const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
  ok(res.status === 200, `${name} ready`);
  const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
  ok(metrics.status === 200 && (await metrics.text()).includes('process_cpu'), `${name} exposes /metrics`);
}
ok((await fetch(`${api}/openapi.json`)).status === 200, 'OpenAPI document served');

console.log('smoke: signup and catalog');
const slug = `smoke-${Date.now().toString(36)}`.slice(0, 32);
const email = `${slug}@merchant.dev`;
const signup = await json(api, 'POST', '/v1/auth/signup', {
  body: {
    email,
    password: 'password123',
    name: 'Smoke Owner',
    storeName: 'Smoke Store',
    storeSlug: slug,
    currency: 'USD',
  },
});
ok(signup.status === 201, 'merchant signup');
const tenantId = signup.body.memberships[0].tenantId;
const headers = { authorization: `Bearer ${signup.body.accessToken}`, 'x-tenant-id': tenantId };
const product = await json(api, 'POST', '/v1/admin/products', {
  headers,
  body: {
    title: 'Smoke Test Runner',
    status: 'active',
    description: '**Fast** shoe',
    variants: [{ sku: `SMK-${Date.now()}`, title: '42', priceCents: 8900, onHand: 5 }],
  },
});
ok(product.status === 201, 'product created');
const settings = await json(api, 'GET', '/v1/admin/settings', { headers });
const trackingKey = settings.body.trackingKey;
ok(/^pk_live_/.test(trackingKey), 'store has a publishable tracking key');

console.log('smoke: storefront purchase');
const cookie = `cip_store=${slug}; cip_aid=${randomUUID()}`;
const pdp = await waitFor(
  async () => {
    const res = await fetch(`${storefront}/p/${product.body.slug}`, { headers: { cookie } });
    const html = await res.text();
    return res.status === 200 && html.includes('Smoke Test Runner') ? html : null;
  },
  20000,
  'storefront product page',
);
ok(pdp.includes('Smoke Store'), 'storefront renders the new product (ISR on demand) with store branding');
const sf = (method, path, body, extra = {}) =>
  json(storefront, method, `/api${path}`, { body, headers: { cookie, ...extra } });
const cart = await sf('POST', '/v1/storefront/cart/items', {
  variantId: product.body.variants[0].id,
  quantity: 1,
});
ok(cart.status === 200 && cart.body.itemsCount === 1, 'cart via storefront proxy');
const key = `smoke-${randomUUID()}`;
const checkout = await sf(
  'POST',
  '/v1/storefront/checkout',
  {
    email: `buyer-${slug}@buyer.dev`,
    shippingAddress: { name: 'Buyer', line1: 'Main 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
    shippingMethod: 'standard',
  },
  { 'idempotency-key': key },
);
ok(checkout.status === 201, `checkout created order #${checkout.body?.number}`);
const replay = await sf(
  'POST',
  '/v1/storefront/checkout',
  {
    email: `buyer-${slug}@buyer.dev`,
    shippingAddress: { name: 'Buyer', line1: 'Main 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
    shippingMethod: 'standard',
  },
  { 'idempotency-key': key },
);
ok(
  replay.headers.get('idempotent-replayed') === 'true' && replay.body.orderId === checkout.body.orderId,
  'idempotent replay returns the same order',
);
const confirm = await sf('POST', `/v1/payments/fake/${checkout.body.payment.intentId}/confirm`, {
  cardNumber: '4242424242424242',
});
ok(confirm.status === 202, 'fake payment confirmed');
await waitFor(
  async () => (await sf('GET', `/v1/storefront/orders/${checkout.body.orderId}`)).body.status === 'paid',
  20000,
  'webhook marks the order paid',
);
ok(true, 'signed webhook moved the order to paid');

console.log('smoke: email via queue');
const mail = await waitFor(
  async () => {
    const res = await fetch(
      `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:buyer-${slug}@buyer.dev`)}`,
    );
    const body = await res.json();
    return body.messages?.length ? body.messages[0] : null;
  },
  20000,
  'order email in Mailpit',
);
ok(mail.Subject.includes(`order #${checkout.body.number}`), `Mailpit received "${mail.Subject}"`);

console.log('smoke: realtime websocket');
const ticket = await json(api, 'POST', '/v1/admin/realtime/ticket', { headers });
ok(ticket.status === 201, 'realtime ticket issued');
const ws = new WebSocket(`${ticket.body.url}?ticket=${ticket.body.ticket}`);
const wsMessages = [];
ws.on('message', (data) => wsMessages.push(JSON.parse(String(data))));
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

console.log('smoke: tracking events');
const events = Array.from({ length: 5 }, () => ({
  event_id: randomUUID(),
  event_type: 'product_viewed',
  occurred_at: new Date().toISOString(),
  anonymous_id: randomUUID(),
  properties: {
    product_id: product.body.id,
    category_path: '',
    price_cents: 8900,
    title: 'Smoke Test Runner',
  },
}));
const collect = await json(`http://127.0.0.1:${ports.collector}`, 'POST', '/v1/events', {
  headers: { 'x-api-key': trackingKey },
  body: { events },
});
ok(collect.status === 202 && collect.body.accepted === 5, 'collector accepted 5 events');
const duplicate = await json(`http://127.0.0.1:${ports.collector}`, 'POST', '/v1/events', {
  headers: { 'x-api-key': trackingKey },
  body: { events },
});
ok(duplicate.status === 202, 'collector accepted a duplicate batch');
const rows = await waitFor(
  async () => {
    const result = await clickhouse(
      `SELECT event_type, count() AS n FROM events FINAL WHERE tenant_id = '${tenantId}' GROUP BY event_type`,
    );
    const counts = Object.fromEntries(result.map((r) => [r.event_type, Number(r.n)]));
    return counts.product_viewed === 5 && counts.order_paid === 1 && counts.order_placed === 1
      ? counts
      : null;
  },
  30000,
  'events in ClickHouse',
);
ok(rows.product_viewed === 5, 'ClickHouse has 5 product_viewed rows (duplicates removed)');
ok(
  rows.order_paid === 1 && rows.purchase_item === 1,
  'ClickHouse has order_paid and purchase_item from the outbox',
);
await waitFor(
  async () => (wsMessages.some((m) => m.type === 'tick' && m.eventsPerSec >= 0) ? true : null),
  10000,
  'live tick over WebSocket',
);
ok(true, 'live tick received over WebSocket');
ws.close();
const overview = await json(api, 'GET', '/v1/admin/analytics/overview', { headers });
ok(overview.body.revenueCents.value === checkout.body.totalCents, 'analytics overview shows the revenue');

console.log('smoke: platform DLQ');
const platform = await json(api, 'POST', '/v1/auth/login', {
  body: { email: 'platform@cip.dev', password: 'demo1234' },
});
ok(platform.status === 200, 'platform admin login');
const dlq = await json(api, 'GET', '/v1/platform/dlq', {
  headers: { authorization: `Bearer ${platform.body.accessToken}` },
});
ok(dlq.status === 200 && dlq.body.data.length === 9, 'DLQ endpoint lists 9 dead-letter queues');

console.log('smoke: admin app');
const login = await fetch(`${admin}/login`);
ok(
  login.status === 200 && (await login.text()).includes('Commerce Intelligence · Admin'),
  'admin login page served',
);
const proxied = await json(admin, 'POST', '/api/v1/auth/login', {
  body: { email: 'owner@runhub.dev', password: 'demo1234' },
});
ok(
  proxied.status === 200 && proxied.headers.get('set-cookie')?.includes('cip_rt='),
  'admin proxy logs in and sets the refresh cookie',
);

console.log('smoke: M4 profiles, segments, recommendations, embeddings');
const db = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL });
await db.connect();
const fakeWebhook = await db.query(
  'select status, attempts from fake_payment_webhooks where intent_id = $1',
  [checkout.body.payment.intentId],
);
ok(
  fakeWebhook.rows.length === 1 && fakeWebhook.rows[0].status === 'delivered',
  'fake payment webhook was persisted before delivery and marked delivered',
);
const embedded = await waitFor(
  async () => {
    const r = await db.query(
      'select embedding_version, vector_dims(embedding) as dims from products where id = $1',
      [product.body.id],
    );
    return r.rows[0]?.embedding_version ? r.rows[0] : null;
  },
  20000,
  'embedding of the new product',
);
ok(embedded.dims === 384, `domain-worker embedded the new product (${embedded.embedding_version})`);
const owner = await json(api, 'POST', '/v1/auth/login', {
  body: { email: 'owner@runhub.dev', password: 'demo1234' },
});
const runhubId = owner.body.memberships.find((m) => m.slug === 'runhub').tenantId;
const oh = { authorization: `Bearer ${owner.body.accessToken}`, 'x-tenant-id': runhubId };
const runhubStore = await json(api, 'GET', '/v1/storefront/store', { headers: { 'x-store': 'runhub' } });
const shoes = await json(api, 'GET', '/v1/storefront/catalog/products?category=road-shoes&limit=10', {
  headers: { 'x-store': 'runhub' },
});
const visitor = randomUUID();
const vh = { 'x-store': 'runhub', 'x-anonymous-id': visitor };
const coldReco = await json(api, 'GET', '/v1/storefront/recommendations?type=for_you&limit=6', {
  headers: vh,
});
ok(
  coldReco.status === 200 && coldReco.body.coldStart === true && coldReco.body.items.length > 0,
  'cold-start "For you" falls back to popular products',
);
const session = randomUUID();
const views = shoes.body.data.slice(0, 5).map((p) => ({
  event_id: randomUUID(),
  event_type: 'product_viewed',
  occurred_at: new Date().toISOString(),
  anonymous_id: visitor,
  session_id: session,
  properties: {
    product_id: p.id,
    category_path: p.categoryPath,
    price_cents: p.priceMinCents,
    brand: p.brand,
  },
}));
const sentViews = await json(`http://127.0.0.1:${ports.collector}`, 'POST', '/v1/events', {
  headers: { 'x-api-key': runhubStore.body.trackingKey },
  body: { events: views },
});
ok(sentViews.status === 202, 'collector accepted 5 running-shoe views');
const profile = await waitFor(
  async () => {
    const r = await json(api, 'GET', `/v1/admin/profiles/${visitor}`, { headers: oh });
    return r.body.source === 'live' && r.body.affinity.categories[0]?.key === 'running' ? r.body : null;
  },
  15000,
  'live profile',
);
ok(
  profile.segments.some((s) => s.key === 'runners'),
  `profile lands in segments ${profile.segments.map((s) => s.key).join(', ')}`,
);
const warmReco = await json(api, 'GET', '/v1/storefront/recommendations?type=for_you&limit=6', {
  headers: vh,
});
ok(
  warmReco.body.coldStart === false && warmReco.body.items[0].contributions,
  '"For you" is personalized after five views and carries contributions',
);
const similar = await json(
  api,
  'GET',
  `/v1/storefront/recommendations?type=similar&productId=${shoes.body.data[0].id}&limit=4`,
  { headers: vh },
);
ok(similar.status === 200 && similar.body.items.length > 0, 'similar products via pgvector');
const segments = await json(api, 'GET', '/v1/admin/segments', { headers: oh });
ok(segments.body.data.filter((s) => s.isSystem).length === 6, 'six system segments exist');
const preview = await json(api, 'POST', '/v1/admin/segments/preview', {
  headers: oh,
  body: { rules: { all: [{ feature: 'aff.cat.running', op: 'gte', value: 1 }] } },
});
ok(
  preview.status === 200 && typeof preview.body.count === 'number',
  `segment preview answers (${preview.body.count} of ${preview.body.total})`,
);

console.log('smoke: M5 campaigns, LLM creatives, decisions, bandit feedback');
const hero = await json(api, 'GET', '/v1/storefront/decisions?placement=home_hero', { headers: vh });
ok(
  hero.status === 200 && hero.body.creative.headline,
  `seeded campaign serves "${hero.body.creative?.headline}" (${hero.body.policy}, segment ${hero.body.segmentKey})`,
);
const why = await json(api, 'GET', `/v1/storefront/decisions/${hero.body.decisionId}/explanation`, {
  headers: vh,
});
ok(why.status === 200 && why.body.creative.arms.length === 4, 'explanation lists the four arms');
const campaign = await json(api, 'POST', '/v1/admin/campaigns', {
  headers: oh,
  body: {
    name: 'Smoke banner',
    placement: 'category_banner',
    targetSegments: ['runners'],
    productSelector: { categoryPath: 'running' },
    goal: 'click',
  },
});
ok(campaign.status === 201, 'campaign created');
const generated = await json(api, 'POST', `/v1/admin/campaigns/${campaign.body.id}/creatives/generate`, {
  headers: oh,
  body: { segments: ['runners'], tones: ['performance', 'lifestyle'], count: 3 },
});
ok(
  generated.status === 201 && generated.body.creatives.length > 0,
  `Fake LLM generated ${generated.body.creatives.length} draft(s) with guardrails`,
);
const approvable = generated.body.creatives.find(
  (c) => !c.guardrailFlags.some((f) => ['unverified_claim', 'prompt_injection'].includes(f)),
);
const review = await json(api, 'POST', `/v1/admin/creatives/${approvable.id}/review`, {
  headers: oh,
  body: { decision: 'approve' },
});
ok(review.body.status === 'approved', 'creative approved by a user with marketing:approve');
await json(api, 'PATCH', `/v1/admin/campaigns/${campaign.body.id}`, {
  headers: oh,
  body: { status: 'active' },
});
let banner = null;
for (let i = 0; i < 20 && (!banner || banner.policy === 'holdout_uniform'); i++)
  banner = (
    await json(api, 'GET', '/v1/storefront/decisions?placement=category_banner', {
      headers: { 'x-store': 'runhub', 'x-anonymous-id': i === 0 ? visitor : randomUUID() },
    })
  ).body;
ok(banner.creativeId === approvable.id, 'only the approved creative is served for the new campaign');
const adProps = {
  decision_id: banner.decisionId,
  campaign_id: banner.campaignId,
  creative_id: banner.creativeId,
  placement: 'category_banner',
  segment_key: banner.segmentKey,
};
const adEvents = ['ad_impression', 'ad_impression', 'ad_clicked'].map((type) => ({
  event_id: randomUUID(),
  event_type: type,
  occurred_at: new Date().toISOString(),
  anonymous_id: visitor,
  properties: adProps,
}));
await json(`http://127.0.0.1:${ports.collector}`, 'POST', '/v1/events', {
  headers: { 'x-api-key': runhubStore.body.trackingKey },
  body: { events: adEvents },
});
const arm = await waitFor(
  async () => {
    const exp = await json(api, 'GET', `/v1/admin/campaigns/${campaign.body.id}/experiment`, { headers: oh });
    const row = exp.body.segments
      .flatMap((s) => s.arms)
      .find((a) => a.creativeId === approvable.id && a.successes >= 1);
    return row ?? null;
  },
  20000,
  'bandit feedback',
);
ok(
  arm.impressions === 1 && arm.successes === 1,
  'bandit counted one impression (deduplicated by decision_id) and one click',
);
const logged = await waitFor(
  async () => {
    const rows = await clickhouse(`SELECT count() AS n FROM decisions WHERE tenant_id = '${runhubId}'`);
    return Number(rows[0]?.n) > 0 ? Number(rows[0].n) : null;
  },
  20000,
  'decisions in ClickHouse',
);
ok(logged > 0, `${logged} decisions logged to ClickHouse via the queue`);

console.log('smoke: M7 webhooks, CSV import, AI insights');
const hookHits = [];
const hookServer = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hookHits.push({ signature: req.headers['x-signature'], body });
    res.end('ok');
  });
});
await new Promise((r) => hookServer.listen(0, '127.0.0.1', r));
const hook = await json(api, 'POST', '/v1/admin/webhooks', {
  headers,
  body: { url: `http://127.0.0.1:${hookServer.address().port}/hook`, events: ['order.paid'] },
});
ok(hook.status === 201 && hook.body.secret.startsWith('whsec_'), 'webhook endpoint registered');
const cart2 = await sf('POST', '/v1/storefront/cart/items', {
  variantId: product.body.variants[0].id,
  quantity: 1,
});
const order2 = await sf(
  'POST',
  '/v1/storefront/checkout',
  {
    email: `hook-${slug}@buyer.dev`,
    shippingAddress: { name: 'Buyer', line1: 'Main 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
    shippingMethod: 'standard',
  },
  { 'idempotency-key': `smoke-${randomUUID()}` },
);
ok(cart2.status === 200 && order2.status === 201, 'second order placed');
await sf('POST', `/v1/payments/fake/${order2.body.payment.intentId}/confirm`, {
  cardNumber: '4242424242424242',
});
const hit = await waitFor(
  async () => hookHits.find((h) => h.body.includes(order2.body.orderId)),
  30000,
  'webhook delivery',
);
const [tPart, vPart] = String(hit.signature).split(',');
const expected = createHmac('sha256', hook.body.secret)
  .update(`${tPart.slice(2)}.${hit.body}`)
  .digest('hex');
ok(vPart === `v1=${expected}`, 'order.paid webhook delivered with a valid HMAC signature');
hookServer.close();
const csvRes = await fetch(`${api}/v1/admin/products/import`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'text/csv' },
  body: `title,sku,price,stock\nCSV Shoe,CSV-${Date.now()},49.00,3\nBroken,,x,1\n`,
});
const importJob = await csvRes.json();
const finished = await waitFor(
  async () => {
    const r = await json(api, 'GET', `/v1/admin/jobs/${importJob.jobId}`, { headers });
    return r.body.status === 'completed' ? r.body : null;
  },
  20000,
  'CSV import job',
);
ok(
  finished.result.productsCreated === 1 && finished.errors[0].row === 3,
  'CSV import created 1 product and reported row 3',
);
const insights = await json(api, 'GET', '/v1/admin/analytics/insights', { headers: oh });
ok(
  insights.status === 200 && insights.body.observations.length > 0,
  `AI insights: ${insights.body.observations.length} grounded observations`,
);

console.log('smoke: M6 simulator');
const ph = { authorization: `Bearer ${platform.body.accessToken}` };
await json(api, 'POST', '/v1/platform/simulator', { headers: ph, body: { action: 'start', rate: 3 } });
const simStats = await waitFor(
  async () => {
    const r = await json(api, 'GET', '/v1/platform/simulator', { headers: ph });
    return r.body.stats.decisions > 0 ? r.body.stats : null;
  },
  45000,
  'simulator sessions',
);
await json(api, 'POST', '/v1/platform/simulator', { headers: ph, body: { action: 'stop' } });
ok(
  simStats.sessions > 0,
  `simulator ran ${simStats.sessions} sessions with ${simStats.decisions} decisions through the public APIs`,
);
const truth = await json(api, 'GET', '/v1/platform/simulator/ground-truth', { headers: ph });
ok(truth.status === 200 && truth.body.rows.length === 5, 'ground truth vs learned table has five personas');
await db.end();
const campaignsPage = await fetch(`${admin}/marketing/campaigns`);
ok(campaignsPage.status === 200, 'admin campaigns page served');

console.log(`smoke: ${checks} checks passed`);
