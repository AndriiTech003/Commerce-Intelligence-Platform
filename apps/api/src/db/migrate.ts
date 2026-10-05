import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

export const migrationsFolder =
  [
    join(here, 'migrations'),
    join(here, '..', 'migrations'),
    join(here, '..', 'src', 'db', 'migrations'),
  ].find((dir) => existsSync(join(dir, 'meta', '_journal.json'))) ?? join(here, 'migrations');

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function withUser(url: string, user: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = '';
  return parsed.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function assertName(name: string): void {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`invalid database name ${name}`);
}

export async function databaseExists(adminUrl: string, name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: withDatabase(adminUrl, 'postgres') });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    return (rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}

export async function createDatabase(adminUrl: string, name: string): Promise<void> {
  assertName(name);
  if (await databaseExists(adminUrl, name)) return;
  const client = new pg.Client({ connectionString: withDatabase(adminUrl, 'postgres') });
  await client.connect();
  try {
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

export async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  assertName(name);
  const client = new pg.Client({ connectionString: withDatabase(adminUrl, 'postgres') });
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await client.end();
  }
}

export async function runMigrations(adminUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await pool.query("select pg_advisory_lock(hashtext('cip_migrations'))");
    try {
      await migrate(drizzle(pool), { migrationsFolder });
    } finally {
      await pool.query("select pg_advisory_unlock(hashtext('cip_migrations'))");
    }
  } finally {
    await pool.end();
  }
}
