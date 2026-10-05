import { EMBEDDING_DIMENSIONS, fitDimensions, hashEmbedding } from './embeddings';

export const EMBEDDING_PROVIDERS = ['hash', 'local', 'openai', 'voyage'] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  embed(texts: string[], purpose?: 'document' | 'query'): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderName;
  model?: string | undefined;
  url?: string | undefined;
  apiKey?: string | undefined;
  version?: string | undefined;
  dimensions?: number | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

const DEFAULT_MODELS: Record<EmbeddingProviderName, string> = {
  hash: 'feature-hashing-v1',
  local: 'Xenova/all-MiniLM-L6-v2',
  openai: 'text-embedding-3-small',
  voyage: 'voyage-3.5-lite',
};

const DEFAULT_URLS: Partial<Record<EmbeddingProviderName, string>> = {
  local: 'http://127.0.0.1:4189',
  openai: 'https://api.openai.com',
  voyage: 'https://api.voyageai.com',
};

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok)
      throw new EmbeddingProviderError(
        `embedding request failed: ${response.status} ${text.slice(0, 200)}`,
        response.status,
      );
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof EmbeddingProviderError) throw error;
    throw new EmbeddingProviderError(
      `embedding request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function vectorsFrom(body: unknown, expected: number, dimensions: number): number[][] {
  const data = (body as { data?: Array<{ embedding?: unknown; index?: number }> })?.data;
  if (!Array.isArray(data) || data.length !== expected)
    throw new EmbeddingProviderError('embedding response has an unexpected shape');
  return [...data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => {
      if (!Array.isArray(item.embedding)) throw new EmbeddingProviderError('embedding missing in response');
      return fitDimensions(item.embedding.map(Number), dimensions);
    });
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
  const model = config.model || DEFAULT_MODELS[config.provider];
  const version = config.version || `${config.provider}:${model}:${dimensions}`;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 30000;
  const base = (config.url || DEFAULT_URLS[config.provider] || '').replace(/\/$/, '');
  switch (config.provider) {
    case 'hash':
      return {
        name: 'hash',
        model,
        version,
        dimensions,
        embed: async (texts) => texts.map((t) => hashEmbedding(t, dimensions)),
      };
    case 'local':
    case 'openai':
      return {
        name: config.provider,
        model,
        version,
        dimensions,
        embed: async (texts) => {
          if (texts.length === 0) return [];
          if (config.provider === 'openai' && !config.apiKey)
            throw new EmbeddingProviderError('EMBEDDINGS_API_KEY is required for the openai provider');
          const body = await postJson(
            fetchImpl,
            `${base}/v1/embeddings`,
            { model, input: texts, ...(config.provider === 'openai' ? { dimensions } : {}) },
            config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
            timeoutMs,
          );
          return vectorsFrom(body, texts.length, dimensions);
        },
      };
    case 'voyage':
      return {
        name: 'voyage',
        model,
        version,
        dimensions,
        embed: async (texts, purpose = 'document') => {
          if (texts.length === 0) return [];
          if (!config.apiKey)
            throw new EmbeddingProviderError('EMBEDDINGS_API_KEY is required for the voyage provider');
          const body = await postJson(
            fetchImpl,
            `${base}/v1/embeddings`,
            { model, input: texts, input_type: purpose, output_dimension: dimensions <= 512 ? 512 : 1024 },
            { authorization: `Bearer ${config.apiKey}` },
            timeoutMs,
          );
          return vectorsFrom(body, texts.length, dimensions);
        },
      };
  }
}
