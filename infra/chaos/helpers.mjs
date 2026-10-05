import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const MGMT = env.RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672';
const MGMT_AUTH = `Basic ${Buffer.from(env.RABBITMQ_MANAGEMENT_AUTH ?? 'guest:guest').toString('base64')}`;
const GRAFANA = env.GRAFANA_URL ?? 'http://127.0.0.1:4192';
const PROMETHEUS = env.PROMETHEUS_URL ?? 'http://127.0.0.1:4191';
const RESULTS = env.CHAOS_RESULTS ?? join(here, 'results.md');

function need(name) {
  if (!env[name]) throw new Error(`${name} is not set (eval "$(node scripts/loadtest-env.mjs <profile>)")`);
  return env[name];
}

async function json(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(Number(env.HELPER_TIMEOUT_MS ?? 10000)),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function storeHeaders(anonymousId = randomUUID()) {
  return { 'x-store': need('STORE'), 'x-anonymous-id': anonymousId };
}

async function placeOrder(key = `chaos-${randomUUID()}`, anonymousId = randomUUID()) {
  const api = need('API_URL');
  const headers = storeHeaders(anonymousId);
  const list = await json(`${api}/v1/storefront/catalog/products?limit=48`, { headers });
  const candidates = list.body.data.filter((p) => p.available);
  for (let i = 0; i < 10; i += 1) {
    const item = candidates[Math.floor(Math.random() * candidates.length)];
    const product = await json(`${api}/v1/storefront/catalog/products/${item.slug}`, { headers });
    const variant = product.body?.variants?.find((v) => v.available > 0);
    if (!variant) continue;
    const cart = await json(`${api}/v1/storefront/cart/items`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
    });
    if (cart.status >= 300) continue;
    break;
  }
  const body = JSON.stringify({
    email: `chaos-${anonymousId.slice(0, 8)}@buyer.dev`,
    shippingAddress: {
      name: 'Chaos Buyer',
      line1: 'Main 1',
      city: 'Berlin',
      postalCode: '10115',
      country: 'DE',
    },
    shippingMethod: 'standard',
  });
  const res = await json(`${api}/v1/storefront/checkout`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': key },
    body,
  });
  return { status: res.status, orderId: res.body?.orderId ?? null, key, anonymousId, body };
}

async function replayCheckout(key, anonymousId, body) {
  const res = await json(`${need('API_URL')}/v1/storefront/checkout`, {
    method: 'POST',
    headers: { ...storeHeaders(anonymousId), 'content-type': 'application/json', 'idempotency-key': key },
    body,
  });
  return {
    status: res.status,
    orderId: res.body?.orderId ?? null,
    code: res.body?.code ?? res.body?.type ?? null,
  };
}

async function queues() {
  const vhost = encodeURIComponent(need('RABBITMQ_VHOST'));
  const res = await json(
    `${MGMT}/api/queues/${vhost}?columns=name,messages,messages_ready,messages_unacknowledged`,
    {
      headers: { authorization: MGMT_AUTH },
    },
  );
  if (res.status !== 200) throw new Error(`management API returned ${res.status}`);
  return res.body;
}

async function clickhouse(sql) {
  const url = new URL(need('CLICKHOUSE_URL'));
  url.searchParams.set('database', need('CLICKHOUSE_DATABASE'));
  const response = await fetch(url, { method: 'POST', body: `${sql} FORMAT TabSeparated` });
  const text = (await response.text()).trim();
  if (!response.ok) throw new Error(`ClickHouse: ${text.slice(0, 200)}`);
  return text;
}

async function metric(url, name, filters) {
  const text = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text();
  let total = 0;
  let found = false;
  for (const line of text.split('\n')) {
    if (!line.startsWith(`${name}{`) && !line.startsWith(`${name} `)) continue;
    if (!filters.every((f) => line.includes(f.replace('=', '="') + '"'))) continue;
    total += Number(line.slice(line.lastIndexOf(' ') + 1));
    found = true;
  }
  return found ? total : NaN;
}

async function alertFiring(pattern) {
  const regex = new RegExp(pattern, 'i');
  const where = [];
  const grafana = await json(`${GRAFANA}/api/prometheus/grafana/api/v1/rules`, {
    headers: { authorization: `Basic ${Buffer.from(env.GRAFANA_AUTH ?? 'admin:admin').toString('base64')}` },
  }).catch(() => null);
  for (const group of grafana?.body?.data?.groups ?? [])
    for (const rule of group.rules ?? [])
      if (regex.test(rule.name) && rule.state === 'firing') where.push(`grafana:${rule.name}`);
  const prom = await json(`${PROMETHEUS}/api/v1/alerts`).catch(() => null);
  for (const alert of prom?.body?.data?.alerts ?? [])
    if (regex.test(alert.labels.alertname) && alert.state === 'firing')
      where.push(`prometheus:${alert.labels.alertname}`);
  return [...new Set(where)];
}

function summaryValue(file, path) {
  if (!existsSync(file)) return '';
  let value = JSON.parse(readFileSync(file, 'utf8'));
  for (const part of path.split('.')) value = value?.[part];
  return value ?? '';
}

function result(scenario, expectation, observed, status) {
  if (!existsSync(RESULTS))
    writeFileSync(
      RESULTS,
      '# Chaos results\n\n| Date | Scenario | Expectation | Observed | Result |\n|---|---|---|---|---|\n',
    );
  const clean = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
  const date = `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  appendFileSync(
    RESULTS,
    `| ${date} | ${clean(scenario)} | ${clean(expectation)} | ${clean(observed)} | ${status} |\n`,
  );
  return `${scenario} | ${expectation} | ${observed} | ${status}`;
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  async orders([n = '10']) {
    const results = [];
    for (let i = 0; i < Number(n); i += 1) results.push(await placeOrder());
    const created = results.filter((r) => r.status === 201);
    return JSON.stringify({
      created: created.length,
      failed: results.length - created.length,
      ids: created.map((r) => r.orderId),
    });
  },
  async 'order-with-key'() {
    return JSON.stringify(await placeOrder());
  },
  async replay([file]) {
    const order = JSON.parse(readFileSync(file, 'utf8'));
    return JSON.stringify(await replayCheckout(order.key, order.anonymousId, order.body));
  },
  async queue([name]) {
    const q = (await queues()).find((x) => x.name === name);
    return String(q ? q.messages : 0);
  },
  async backlog() {
    return String(
      (await queues()).filter((q) => !q.name.endsWith('.dlq')).reduce((n, q) => n + (q.messages ?? 0), 0),
    );
  },
  async dlq() {
    return String(
      (await queues()).filter((q) => q.name.endsWith('.dlq')).reduce((n, q) => n + (q.messages ?? 0), 0),
    );
  },
  async ch([sql]) {
    return clickhouse(sql);
  },
  async metric([url, name, ...filters]) {
    const value = await metric(url, name, filters);
    return Number.isNaN(value) ? '' : String(value);
  },
  async alert([pattern]) {
    return (await alertFiring(pattern)).join(',');
  },
  async summary([file, path]) {
    return String(summaryValue(file, path));
  },
  async result([scenario, expectation, observed, status]) {
    return result(scenario, expectation, observed, status);
  },
};

if (!commands[command]) {
  process.stderr.write(`usage: node infra/chaos/helpers.mjs ${Object.keys(commands).join('|')} ...\n`);
  process.exit(2);
}
try {
  process.stdout.write(`${await commands[command](args)}\n`);
} catch (error) {
  process.stderr.write(`helpers: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
