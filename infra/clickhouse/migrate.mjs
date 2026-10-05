import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

async function exec(url, sql, database) {
  const target = new URL(url);
  if (database) target.searchParams.set('database', database);
  const response = await fetch(target, {
    method: 'POST',
    body: sql,
    headers: { 'content-type': 'text/plain' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ClickHouse error: ${text.trim()}\nSQL: ${sql.slice(0, 300)}`);
  return text;
}

export function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function migrateClickHouse({
  url = 'http://127.0.0.1:8123',
  database = 'cip',
  log = () => {},
} = {}) {
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error(`invalid database name ${database}`);
  await exec(url, `CREATE DATABASE IF NOT EXISTS ${database}`);
  await exec(
    url,
    'CREATE TABLE IF NOT EXISTS schema_migrations (version String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY version',
    database,
  );
  const applied = new Set(
    (await exec(url, 'SELECT version FROM schema_migrations FORMAT TabSeparated', database))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const ran = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    for (const statement of splitStatements(readFileSync(join(migrationsDir, file), 'utf8'))) {
      await exec(url, statement, database);
    }
    await exec(url, `INSERT INTO schema_migrations (version) VALUES ('${version}')`, database);
    ran.push(version);
    log(`clickhouse: applied ${version}`);
  }
  return ran;
}

export async function dropClickHouseDatabase({ url = 'http://127.0.0.1:8123', database }) {
  if (!database || !/^[a-zA-Z0-9_]+$/.test(database) || database === 'default' || database === 'system') {
    throw new Error('refusing to drop this database');
  }
  await exec(url, `DROP DATABASE IF EXISTS ${database}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ran = await migrateClickHouse({
    url: process.env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
    database: process.argv[2] ?? process.env.CLICKHOUSE_DATABASE ?? 'cip',
    log: (m) => console.log(m),
  });
  console.log(`clickhouse: ${ran.length} migration(s) applied`);
}
