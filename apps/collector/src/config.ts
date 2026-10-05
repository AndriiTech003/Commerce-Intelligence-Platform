import { z } from 'zod';
import { baseEnvSchema, envPort, loadEnv } from '@cip/observability';

export const collectorEnvSchema = baseEnvSchema.extend({
  COLLECTOR_PORT: envPort.default(4110),
  COLLECTOR_HOST: z.string().default('127.0.0.1'),
  DATABASE_SYSTEM_URL: z.string().url().default('postgres://app_system@127.0.0.1:5432/cip'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/1'),
  REDIS_PREFIX: z.string().default(''),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@127.0.0.1:5672/cip'),
  RATE_LIMIT_PER_KEY: z.coerce.number().int().min(1).default(1000),
  RATE_LIMIT_BURST: z.coerce.number().int().min(1).default(2000),
  RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).default(500),
  BUFFER_MAX: z.coerce.number().int().min(0).default(10000),
  KEY_CACHE_MS: z.coerce.number().int().min(0).default(60000),
  MAX_EVENTS_PER_BATCH: z.coerce.number().int().min(1).default(50),
  MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(64 * 1024),
});

export type CollectorConfig = z.infer<typeof collectorEnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): CollectorConfig {
  return loadEnv(collectorEnvSchema, env);
}
