import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { baseEnvSchema, envPort, loadEnv } from '@cip/observability';

export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../.cache/embeddings', import.meta.url));

export const embeddingsEnvSchema = baseEnvSchema.extend({
  EMBEDDINGS_SERVER_PORT: envPort.default(4189),
  EMBEDDINGS_SERVER_HOST: z.string().default('127.0.0.1'),
  EMBEDDINGS_MODEL: z.string().min(1).default('Xenova/all-MiniLM-L6-v2'),
  EMBEDDINGS_DTYPE: z.enum(['q8', 'int8', 'uint8', 'fp16', 'fp32']).default('q8'),
  EMBEDDINGS_CACHE_DIR: z.string().min(1).default(DEFAULT_CACHE_DIR),
  EMBEDDINGS_THREADS: z.coerce.number().int().min(1).max(16).default(2),
  EMBEDDINGS_BATCH_SIZE: z.coerce.number().int().min(1).max(128).default(8),
  EMBEDDINGS_MAX_INPUTS: z.coerce.number().int().min(1).max(2048).default(128),
  EMBEDDINGS_MAX_CHARS: z.coerce.number().int().min(16).default(2000),
});

export type EmbeddingsConfig = z.infer<typeof embeddingsEnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): EmbeddingsConfig {
  return loadEnv(embeddingsEnvSchema, env);
}
