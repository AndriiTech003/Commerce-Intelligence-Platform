import { randomBytes } from 'node:crypto';
import type { TestProject } from 'vitest/node';
import { amqpUrlFor, applyTopology, deleteVhost } from '../../../../infra/rabbitmq/apply.mjs';

declare module 'vitest' {
  export interface ProvidedContext {
    env: Record<string, string>;
  }
}

export default async function setup(project: TestProject) {
  const id = randomBytes(4).toString('hex');
  const managementUrl = process.env.TEST_RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672';
  const vhost = `cip_test_col_${id}`;
  await applyTopology({ managementUrl, vhost });
  project.provide('env', {
    RABBITMQ_URL: amqpUrlFor(vhost, process.env.TEST_RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672'),
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1',
    REDIS_PREFIX: `tcol${id}:`,
    COLLECTOR_PORT: '0',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_PER_KEY: '50',
    RATE_LIMIT_BURST: '100',
    RATE_LIMIT_PER_IP: '100000',
  });
  return async () => {
    await deleteVhost({ managementUrl, vhost }).catch(() => undefined);
  };
}
