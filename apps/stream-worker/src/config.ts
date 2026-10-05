import { z } from 'zod';
import { baseEnvSchema, envBool, envPort, loadEnv } from '@cip/observability';

export const streamEnvSchema = baseEnvSchema.extend({
  STREAM_WORKER_PORT: envPort.default(4150),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/1'),
  REDIS_PREFIX: z.string().default(''),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@127.0.0.1:5672/cip'),
  CLICKHOUSE_URL: z.string().url().default('http://127.0.0.1:8123'),
  CLICKHOUSE_DATABASE: z.string().default('cip'),
  BATCH_SIZE: z.coerce.number().int().min(1).default(1000),
  FLUSH_INTERVAL_MS: z.coerce.number().int().min(10).default(1000),
  FEED_SAMPLE_PER_SEC: z.coerce.number().int().min(1).default(20),
  TICK_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  PROFILE_BATCH_SIZE: z.coerce.number().int().min(1).default(200),
  PROFILE_FLUSH_MS: z.coerce.number().int().min(10).default(100),
  POPULAR_REFRESH_MS: z.coerce.number().int().min(1000).default(600_000),
  QUANTILE_REFRESH_MS: z.coerce.number().int().min(1000).default(3_600_000),
  CLICKHOUSE_DEDUP_CHECK: envBool.default(true),
  CHAOS_DELAY_MS: z.coerce.number().int().min(0).default(0),
});

export type StreamConfig = z.infer<typeof streamEnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): StreamConfig {
  return loadEnv(streamEnvSchema, env);
}
