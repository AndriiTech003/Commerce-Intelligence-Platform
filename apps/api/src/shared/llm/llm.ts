import { counter, histogram } from '@cip/observability';

export const LLM_CLIENT = Symbol('LLM_CLIENT');

export type LlmTask = 'creative' | 'insights';

export interface LlmRequest {
  task: LlmTask;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  context?: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
}

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export const llmMetrics = () => ({
  requests: counter('llm_requests_total', 'LLM requests', ['provider', 'task', 'outcome']),
  cost: counter('llm_cost_usd_total', 'Estimated LLM cost in USD', ['provider', 'task']),
  tokens: counter('llm_tokens_total', 'LLM tokens', ['provider', 'direction']),
  latency: histogram(
    'llm_latency_seconds',
    'LLM request latency',
    ['provider', 'task'],
    [0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60],
  ),
});

export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  override?: { input?: number | undefined; output?: number | undefined },
): number {
  const price = PRICES_PER_MTOK[model] ?? { input: 0, output: 0 };
  const input = override?.input ?? price.input;
  const output = override?.output ?? price.output;
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

export function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new SyntaxError('response is not JSON');
  }
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => variables[name] ?? '');
}
