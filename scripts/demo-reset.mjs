import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropClickHouseDatabase, migrateClickHouse } from '../infra/clickhouse/migrate.mjs';
import { applyTopology, deleteVhost } from '../infra/rabbitmq/apply.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};

const env = {
  DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL ?? 'postgres://127.0.0.1:5432/cip',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/1',
  REDIS_PREFIX: process.env.REDIS_PREFIX ?? '',
  RABBITMQ_VHOST: process.env.RABBITMQ_VHOST ?? 'cip',
  RABBITMQ_MANAGEMENT_URL: process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672',
  CLICKHOUSE_URL: process.env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
  CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE ?? 'cip',
  API_PORT: process.env.API_PORT ?? '4100',
  STREAM_WORKER_PORT: process.env.STREAM_WORKER_PORT ?? '4150',
};
env.API_URL = process.env.API_URL ?? `http://127.0.0.1:${env.API_PORT}`;
env.INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? env.API_URL;
env.RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? `amqp://guest:guest@127.0.0.1:5672/${encodeURIComponent(env.RABBITMQ_VHOST)}`;
env.DATABASE_URL =
  process.env.DATABASE_URL ?? env.DATABASE_ADMIN_URL.replace('postgres://', 'postgres://app_user@');
env.DATABASE_SYSTEM_URL =
  process.env.DATABASE_SYSTEM_URL ?? env.DATABASE_ADMIN_URL.replace('postgres://', 'postgres://app_system@');

const days = Number(flag('days', '90'));
const sessionsPerDay = Number(flag('sessions-per-day', '200'));

function log(message) {
  process.stdout.write(`demo-reset: ${message}\n`);
}

function run(command, commandArgs) {
  execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

async function reachable(url) {
  return fetch(url)
    .then((r) => r.status < 500)
    .catch(() => false);
}

async function waitFor(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reachable(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not become ready`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  await exited;
  clearTimeout(timer);
}

async function main() {
  if (!args.includes('--yes') && process.env.DEMO_RESET_CONFIRM !== '1') {
    process.stderr.write(
      `demo-reset: this drops the Postgres database, ClickHouse database ${env.CLICKHOUSE_DATABASE}, RabbitMQ vhost ${env.RABBITMQ_VHOST} and Redis keys "${env.REDIS_PREFIX}*" in ${env.REDIS_URL}; rerun with --yes\n`,
    );
    process.exit(2);
  }
  log(`ClickHouse: recreating ${env.CLICKHOUSE_DATABASE}`);
  await dropClickHouseDatabase({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DATABASE });
  await migrateClickHouse({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DATABASE });
  log(`RabbitMQ: recreating vhost ${env.RABBITMQ_VHOST}`);
  await deleteVhost({ managementUrl: env.RABBITMQ_MANAGEMENT_URL, vhost: env.RABBITMQ_VHOST }).catch(
    () => undefined,
  );
  await applyTopology({ managementUrl: env.RABBITMQ_MANAGEMENT_URL, vhost: env.RABBITMQ_VHOST });
  log(`Redis: deleting "${env.REDIS_PREFIX}*" in ${env.REDIS_URL}`);
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
  log(`Redis: ${keys.length} keys deleted`);
  log('Postgres: drop, migrate, seed');
  run('node', ['apps/api/dist/storage-setup.js']);
  run('node', ['apps/api/dist/seed.js', '--reset']);
  if (days <= 0) {
    log('backfill skipped (--days=0)');
    return;
  }
  const children = [];
  try {
    if (!(await reachable(`${env.API_URL}/health/ready`))) {
      log('starting the API and the stream worker for the backfill');
      children.push(
        spawn('node', ['apps/api/dist/main.js'], {
          cwd: root,
          env: { ...process.env, ...env, JOBS_ENABLED: 'false', LOG_LEVEL: 'warn' },
          stdio: 'ignore',
        }),
      );
      children.push(
        spawn('node', ['apps/stream-worker/dist/main.js'], {
          cwd: root,
          env: { ...process.env, ...env, LOG_LEVEL: 'warn' },
          stdio: 'ignore',
        }),
      );
      await waitFor(`${env.API_URL}/health/ready`);
      await waitFor(`http://127.0.0.1:${env.STREAM_WORKER_PORT}/health/ready`);
    }
    log(`backfill: ${days} days × ${sessionsPerDay} sessions`);
    run('node', [
      'apps/simulator/dist/main.js',
      'backfill',
      `--days=${days}`,
      `--sessions-per-day=${sessionsPerDay}`,
    ]);
    const drainDeadline = Date.now() + 300000;
    const managementAuth = `Basic ${Buffer.from('guest:guest').toString('base64')}`;
    let quietPolls = 0;
    await new Promise((r) => setTimeout(r, 6000));
    while (Date.now() < drainDeadline && quietPolls < 2) {
      const response = await fetch(
        `${env.RABBITMQ_MANAGEMENT_URL}/api/queues/${encodeURIComponent(env.RABBITMQ_VHOST)}?columns=name,messages`,
        { headers: { authorization: managementAuth } },
      ).catch(() => null);
      const queues = response?.ok ? await response.json() : null;
      const backlog = queues
        ? queues
            .filter((q) => !/\.(dlq|retry\..+)$/.test(q.name))
            .reduce((sum, q) => sum + Number(q.messages ?? 0), 0)
        : null;
      quietPolls = backlog === 0 ? quietPolls + 1 : 0;
      if (quietPolls < 2) await new Promise((r) => setTimeout(r, 5500));
    }
    if (quietPolls < 2) throw new Error('queues did not drain within 5 minutes');
    log('backfill drained: every queue of the vhost is empty');
  } finally {
    for (const child of children) await stop(child);
  }
  log('done');
}

main().catch((error) => {
  process.stderr.write(`demo-reset: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
