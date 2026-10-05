import { z } from 'zod';
import { baseEnvSchema, envPort, loadEnv } from '@cip/observability';

export const simulatorEnvSchema = baseEnvSchema.extend({
  SIMULATOR_PORT: envPort.default(4160),
  API_URL: z.string().url().default('http://127.0.0.1:4100'),
  COLLECTOR_URL: z.string().url().default('http://127.0.0.1:4110'),
  SIM_STORES: z.string().default('runhub'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/1'),
  REDIS_PREFIX: z.string().default(''),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@127.0.0.1:5672/cip'),
  SIM_SEED: z.coerce.number().int().default(42),
  SIM_PAGE_DELAY_MIN_MS: z.coerce.number().int().min(0).default(250),
  SIM_PAGE_DELAY_MAX_MS: z.coerce.number().int().min(0).default(900),
  SIM_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(300),
});

export type SimulatorConfig = z.infer<typeof simulatorEnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): SimulatorConfig {
  return loadEnv(simulatorEnvSchema, env);
}
