import { randomBytes } from 'node:crypto';
import type { TestProject } from 'vitest/node';
import { dropClickHouseDatabase, migrateClickHouse } from '../../../../infra/clickhouse/migrate.mjs';
import { amqpUrlFor, applyTopology, deleteVhost } from '../../../../infra/rabbitmq/apply.mjs';

declare module 'vitest' {
  export interface ProvidedContext {
    env: Record<string, string>;
  }
}

export default async function setup(project: TestProject) {
  const id = randomBytes(4).toString('hex');
  const managementUrl = process.env.TEST_RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672';
  const clickhouseUrl = process.env.TEST_CLICKHOUSE_URL ?? 'http://127.0.0.1:8123';
  const vhost = `cip_test_sw_${id}`;
  const database = `cip_test_sw_${id}`;
  await applyTopology({ managementUrl, vhost });
  await migrateClickHouse({ url: clickhouseUrl, database });
  project.provide('env', {
    RABBITMQ_URL: amqpUrlFor(vhost, process.env.TEST_RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672'),
    CLICKHOUSE_URL: clickhouseUrl,
    CLICKHOUSE_DATABASE: database,
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
    REDIS_PREFIX: `tsw${id}:`,
    STREAM_WORKER_PORT: '0',
    LOG_LEVEL: 'silent',
    FLUSH_INTERVAL_MS: '200',
    TICK_INTERVAL_MS: '300',
  });
  return async () => {
    await deleteVhost({ managementUrl, vhost }).catch(() => undefined);
    await dropClickHouseDatabase({ url: clickhouseUrl, database }).catch(() => undefined);
  };
}
