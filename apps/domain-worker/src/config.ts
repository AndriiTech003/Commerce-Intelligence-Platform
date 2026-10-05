import { z } from 'zod';
import { baseEnvSchema, envBool, envPort, loadEnv } from '@cip/observability';

export const workerEnvSchema = baseEnvSchema.extend({
  DOMAIN_WORKER_PORT: envPort.default(4151),
  DATABASE_SYSTEM_URL: z.string().url().default('postgres://app_system@127.0.0.1:5432/cip'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/1'),
  REDIS_PREFIX: z.string().default(''),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@127.0.0.1:5672/cip'),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default('Commerce Intelligence <no-reply@cip.local>'),
  STOREFRONT_URL_TEMPLATE: z.string().default('http://{store}.localhost:4130'),
  RELAY_ENABLED: envBool.default(true),
  RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  RESERVATION_EXPIRY_INTERVAL_MS: z.coerce.number().int().min(100).default(30000),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  EMBEDDINGS_PROVIDER: z.enum(['hash', 'local', 'openai', 'voyage']).default('hash'),
  EMBEDDINGS_MODEL: z.string().optional(),
  EMBEDDINGS_URL: z.string().optional(),
  EMBEDDINGS_API_KEY: z.string().optional(),
  EMBEDDINGS_VERSION: z.string().optional(),
  EMBEDDINGS_FLUSH_MS: z.coerce.number().int().min(10).default(500),
  WEBHOOK_RETRY_SCHEDULE: z
    .string()
    .default('60,300,1800,7200,43200')
    .transform((v) =>
      v
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0),
    ),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
  WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
});

export type WorkerConfig = z.infer<typeof workerEnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  return loadEnv(workerEnvSchema, env);
}
