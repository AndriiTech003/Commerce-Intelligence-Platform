import { execFileSync } from 'node:child_process';
import { migrateClickHouse } from '../infra/clickhouse/migrate.mjs';
import { applyTopology } from '../infra/rabbitmq/apply.mjs';

const run = (command, args, env = {}) =>
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });

const vhost = process.env.RABBITMQ_VHOST ?? 'cip';
const clickhouseDatabase = process.env.CLICKHOUSE_DATABASE ?? 'cip';
run('pnpm', ['--filter', '@cip/api', 'db:migrate']);
run('pnpm', ['--filter', '@cip/api', 'storage:setup']);
await applyTopology({
  managementUrl: process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672',
  user: process.env.RABBITMQ_USER ?? 'guest',
  pass: process.env.RABBITMQ_PASS ?? 'guest',
  vhost,
});
console.log(`rabbitmq: topology applied to vhost ${vhost}`);
const ran = await migrateClickHouse({
  url: process.env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
  database: clickhouseDatabase,
  log: (m) => console.log(m),
});
console.log(`clickhouse: ${ran.length} migration(s) applied to ${clickhouseDatabase}`);
