import { z, type ZodType } from 'zod';

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv<T>(schema: ZodType<T>, env: Record<string, string | undefined> = process.env): T {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  return result.data;
}

export const envBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envPort = z.coerce.number().int().min(0).max(65535);

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});
