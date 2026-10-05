import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropClickHouseDatabase, migrateClickHouse } from '../infra/clickhouse/migrate.mjs';
import { amqpUrlFor, applyTopology, deleteVhost } from '../infra/rabbitmq/apply.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILES = { smoke: 4180, e2e: 4170 };

export function stackEnv(profile, id) {
  const base = PROFILES[profile];
  if (!base) throw new Error(`unknown profile ${profile}`);
  const pg = process.env.STACK_PG_URL ?? 'postgres://127.0.0.1:5432';
  const name = `cip_test_${profile}_${id}`;
  const ports = {
    api: base,
    collector: base + 1,
    gateway: base + 2,
    stream: base + 3,
    domain: base + 4,
    storefront: base + 5,
    admin: base + 6,
    simulator: base + 7,
  };
  const env = {
    NODE_ENV: 'production',
    LOG_LEVEL: process.env.STACK_LOG_LEVEL ?? 'warn',
    DATABASE_URL: `${pg.replace('://', '://app_user@').replace(/@[^@]*@/, '@')}/${name}`,
    DATABASE_SYSTEM_URL: `${pg.replace('://', '://app_system@').replace(/@[^@]*@/, '@')}/${name}`,
    DATABASE_ADMIN_URL: `${pg}/${name}`,
    REDIS_URL: process.env.STACK_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
    REDIS_PREFIX: `${profile}${id}:`,
    RABBITMQ_URL: amqpUrlFor(name, process.env.STACK_RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672'),
    RABBITMQ_VHOST: name,
    CLICKHOUSE_URL: process.env.STACK_CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
    CLICKHOUSE_DATABASE: name,
    S3_KEY_PREFIX: `${profile}-${id}/`,
    API_PORT: String(ports.api),
    INTERNAL_API_URL: `http://127.0.0.1:${ports.api}`,
    API_INTERNAL_URL: `http://127.0.0.1:${ports.api}`,
    API_URL: `http://127.0.0.1:${ports.api}`,
    ADMIN_URL: `http://127.0.0.1:${ports.admin}`,
    STOREFRONT_REVALIDATE_URL: `http://127.0.0.1:${ports.storefront}/api/revalidate`,
    STOREFRONT_URL_TEMPLATE: `http://{store}.localhost:${ports.storefront}`,
    REALTIME_PUBLIC_URL: `ws://127.0.0.1:${ports.gateway}/ws`,
    COLLECTOR_PUBLIC_URL: `http://127.0.0.1:${ports.collector}`,
    COLLECTOR_URL: `http://127.0.0.1:${ports.collector}`,
    COLLECTOR_PORT: String(ports.collector),
    GATEWAY_PORT: String(ports.gateway),
    STREAM_WORKER_PORT: String(ports.stream),
    DOMAIN_WORKER_PORT: String(ports.domain),
    SIMULATOR_PORT: String(ports.simulator),
    STOREFRONT_PORT: String(ports.storefront),
    ADMIN_PORT: String(ports.admin),
    FAKE_PAYMENT_DELAY_MS: '1000',
    RESERVATION_EXPIRY_INTERVAL_MS: '10000',
    STOREFRONT_RATE_LIMIT_PER_MIN: '100000',
    LOGIN_RATE_LIMIT: '50',
    RATE_LIMIT_PER_IP: '100000',
    ANALYTICS_CACHE_SECONDS: '0',
    FLUSH_INTERVAL_MS: '300',
    DEFAULT_STORE: 'runhub',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  return { env, ports, name };
}

export const SERVICES = [
  {
    name: 'api',
    cmd: ['node', 'apps/api/dist/main.js'],
    health: (p) => `http://127.0.0.1:${p.api}/health/ready`,
  },
  {
    name: 'collector',
    cmd: ['node', 'apps/collector/dist/main.js'],
    health: (p) => `http://127.0.0.1:${p.collector}/health/ready`,
  },
  {
    name: 'stream-worker',
    cmd: ['node', 'apps/stream-worker/dist/main.js'],
    health: (p) => `http://127.0.0.1:${p.stream}/health/ready`,
  },
  {
    name: 'domain-worker',
    cmd: ['node', 'apps/domain-worker/dist/main.js'],
    health: (p) => `http://127.0.0.1:${p.domain}/health/ready`,
  },
  {
    name: 'realtime-gateway',
    cmd: ['node', 'apps/realtime-gateway/dist/main.js'],
    health: (p) => `http://127.0.0.1:${p.gateway}/health/ready`,
  },
  {
    name: 'storefront',
    cmd: (p) => [
      'node',
      'apps/storefront/node_modules/next/dist/bin/next',
      'start',
      'apps/storefront',
      '-p',
      String(p.storefront),
      '-H',
      '127.0.0.1',
    ],
    health: (p) => `http://127.0.0.1:${p.storefront}/api/revalidate`,
    healthMethod: 'GET',
  },
  {
    name: 'admin',
    cmd: (p) => [
      'node',
      'apps/admin/node_modules/next/dist/bin/next',
      'start',
      'apps/admin',
      '-p',
      String(p.admin),
      '-H',
      '127.0.0.1',
    ],
    health: (p) => `http://127.0.0.1:${p.admin}/login`,
  },
  {
    name: 'simulator',
    cmd: ['node', 'apps/simulator/dist/main.js'],
    health: (p) => `http://127.0.0.1:${p.simulator}/health/ready`,
  },
];

function killAdopted(logDir, signal) {
  let files;
  try {
    files = readdirSync(logDir).filter((f) => f.endsWith('.pid'));
  } catch {
    return;
  }
  for (const file of files) {
    const pid = Number(readFileSync(join(logDir, file), 'utf8').trim());
    if (!pid) continue;
    try {
      process.kill(pid, signal);
    } catch {
      rmSync(join(logDir, file), { force: true });
    }
  }
}

export async function waitHealthy(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not become healthy`);
}

export async function provision({ env, name }) {
  const pgAdmin = `${env.DATABASE_ADMIN_URL.replace(/\/[^/]+$/, '')}/postgres`;
  execFileSync('psql', [pgAdmin, '-qc', `create database "${name}"`], { stdio: 'ignore' });
  await applyTopology({ vhost: env.RABBITMQ_VHOST });
  await migrateClickHouse({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DATABASE });
  execFileSync('node', ['apps/api/dist/storage-setup.js'], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  execFileSync('node', ['apps/api/dist/seed.js'], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

export async function teardown({ env, name }) {
  const pgAdmin = `${env.DATABASE_ADMIN_URL.replace(/\/[^/]+$/, '')}/postgres`;
  try {
    execFileSync('psql', [pgAdmin, '-qc', `drop database if exists "${name}" with (force)`], {
      stdio: 'ignore',
    });
  } catch {
    process.stderr.write('stack: could not drop database\n');
  }
  await deleteVhost({ vhost: env.RABBITMQ_VHOST }).catch(() => undefined);
  await dropClickHouseDatabase({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DATABASE }).catch(
    () => undefined,
  );
  try {
    const keys = execFileSync(
      'redis-cli',
      ['-u', env.REDIS_URL, '--scan', '--pattern', `${env.REDIS_PREFIX}*`, '--count', '5000'],
      { maxBuffer: 1024 * 1024 * 1024 },
    )
      .toString()
      .split('\n')
      .filter(Boolean);
    for (let i = 0; i < keys.length; i += 2000)
      execFileSync('redis-cli', ['-u', env.REDIS_URL, 'unlink', ...keys.slice(i, i + 2000)], {
        stdio: 'ignore',
      });
  } catch {
    process.stderr.write('stack: could not clean redis keys\n');
  }
}

async function run(profile) {
  const id = process.env.STACK_ID ?? `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const stack = stackEnv(profile, id);
  const logDir = join(root, '.smoke', `${profile}-${id}`);
  mkdirSync(logDir, { recursive: true });
  const children = [];
  const chaos = process.env.STACK_CHAOS === '1';
  const only = (process.env.STACK_SERVICES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const services = only.length > 0 ? SERVICES.filter((s) => only.includes(s.name)) : SERVICES;
  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    if (chaos) killAdopted(logDir, 'SIGTERM');
    await new Promise((r) => setTimeout(r, 2500));
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    if (chaos) killAdopted(logDir, 'SIGKILL');
    await teardown(stack);
    rmSync(join(root, '.smoke', `${profile}.json`), { force: true });
    process.exit(code);
  };
  process.on('SIGTERM', () => void stop(0));
  process.on('SIGINT', () => void stop(0));
  try {
    rmSync(join(root, 'apps', 'storefront', '.next', 'cache'), { recursive: true, force: true });
    rmSync(join(root, 'apps', 'storefront', '.next', 'server', 'route-cache'), {
      recursive: true,
      force: true,
    });
    await provision(stack);
    for (const service of services) {
      const cmd = typeof service.cmd === 'function' ? service.cmd(stack.ports) : service.cmd;
      const out = openSync(join(logDir, `${service.name}.log`), 'a');
      const child = spawn(cmd[0], cmd.slice(1), {
        cwd: root,
        env: { ...process.env, ...stack.env },
        stdio: ['ignore', out, out],
      });
      children.push(child);
      child.on('exit', (code, signal) => {
        if (stopping) return;
        if (chaos) {
          process.stderr.write(
            `stack: ${service.name} exited with ${code ?? signal} (STACK_CHAOS=1, keeping the stack)\n`,
          );
          return;
        }
        process.stderr.write(`stack: ${service.name} exited with ${code}\n`);
        void stop(1);
      });
    }
    for (const service of services) await waitHealthy(service.health(stack.ports));
    const chaosInfo = chaos
      ? {
          chaos: true,
          runnerPid: process.pid,
          passEnv: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('OTEL_'))),
        }
      : {};
    writeFileSync(
      join(root, '.smoke', `${profile}.json`),
      JSON.stringify({ id, logDir, ...stack, ...chaosInfo }, null, 2),
    );
    process.stdout.write(`stack: ${profile} ready (logs in ${logDir})\n`);
  } catch (error) {
    process.stderr.write(
      `stack: failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await stop(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const profile = process.argv[2] ?? 'smoke';
  await run(profile);
}
