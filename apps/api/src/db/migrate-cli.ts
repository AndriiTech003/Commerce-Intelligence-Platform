import { createDatabase, databaseName, runMigrations } from './migrate';

const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgres://127.0.0.1:5432/cip';
await createDatabase(adminUrl, databaseName(adminUrl));
await runMigrations(adminUrl);
console.log(`postgres: migrations applied to ${databaseName(adminUrl)}`);
