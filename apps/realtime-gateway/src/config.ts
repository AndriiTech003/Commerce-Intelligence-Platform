import { z } from 'zod';
import { baseEnvSchema, envPort, loadEnv } from '@cip/observability';

export const gatewayEnvSchema = baseEnvSchema.extend({
  GATEWAY_PORT: envPort.default(4120),
  GATEWAY_HOST: z.string().default('127.0.0.1'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/1'),
  REDIS_PREFIX: z.string().default(''),
  HEARTBEAT_MS: z.coerce.number().int().min(100).default(15000),
  MAX_BUFFERED_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(1024 * 1024),
});

export type GatewayConfig = z.infer<typeof gatewayEnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  return loadEnv(gatewayEnvSchema, env);
}
