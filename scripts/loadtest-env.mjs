import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORTS = {
  api: 4100,
  collector: 4110,
  gateway: 4120,
  stream: 4150,
  domain: 4151,
  storefront: 4130,
  admin: 4140,
};

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function loadtestEnv(profile, store = process.env.STORE ?? 'runhub') {
  let ports = DEV_PORTS;
  let env = {
    DATABASE_ADMIN_URL: 'postgres://127.0.0.1:5432/cip',
    REDIS_URL: 'redis://127.0.0.1:6379/1',
    REDIS_PREFIX: '',
    RABBITMQ_VHOST: 'cip',
    CLICKHOUSE_URL: 'http://127.0.0.1:8123',
    CLICKHOUSE_DATABASE: 'cip',
  };
  let extra = { STACK_CHAOS: '0', LOG_DIR: '' };
  if (profile !== 'dev') {
    const file = join(root, '.smoke', `${profile}.json`);
    if (!existsSync(file)) throw new Error(`${file} not found: is the ${profile} stack running?`);
    const stack = JSON.parse(readFileSync(file, 'utf8'));
    ports = stack.ports;
    env = stack.env;
    extra = { STACK_CHAOS: stack.chaos ? '1' : '0', LOG_DIR: stack.logDir };
  }
  const api = `http://127.0.0.1:${ports.api}`;
  const out = {
    PROFILE: profile,
    STORE: store,
    API_URL: api,
    COLLECTOR_URL: `http://127.0.0.1:${ports.collector}`,
    STREAM_METRICS_URL: `http://127.0.0.1:${ports.stream}/metrics`,
    DOMAIN_METRICS_URL: `http://127.0.0.1:${ports.domain}/metrics`,
    COLLECTOR_METRICS_URL: `http://127.0.0.1:${ports.collector}/metrics`,
    DATABASE_ADMIN_URL: env.DATABASE_ADMIN_URL,
    REDIS_URL: env.REDIS_URL,
    REDIS_PREFIX: env.REDIS_PREFIX,
    RABBITMQ_VHOST: env.RABBITMQ_VHOST,
    CLICKHOUSE_URL: env.CLICKHOUSE_URL,
    CLICKHOUSE_DATABASE: env.CLICKHOUSE_DATABASE,
    ...extra,
  };
  const login = await fetch(`${api}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.OWNER_EMAIL ?? `owner@${store}.dev`,
      password: process.env.OWNER_PASSWORD ?? 'demo1234',
    }),
  });
  if (login.status !== 200) throw new Error(`owner login on ${api} failed with ${login.status}`);
  const body = await login.json();
  const membership = body.memberships.find((m) => m.slug === store) ?? body.memberships[0];
  const settings = await fetch(`${api}/v1/admin/settings`, {
    headers: { authorization: `Bearer ${body.accessToken}`, 'x-tenant-id': membership.tenantId },
  });
  if (settings.status !== 200) throw new Error(`GET /v1/admin/settings returned ${settings.status}`);
  out.TENANT_ID = membership.tenantId;
  out.TRACKING_KEY = (await settings.json()).trackingKey;
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const profile = process.argv[2] ?? 'smoke';
  try {
    const vars = await loadtestEnv(profile);
    for (const [key, value] of Object.entries(vars)) process.stdout.write(`export ${key}=${quote(value)}\n`);
  } catch (error) {
    process.stderr.write(`loadtest-env: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
