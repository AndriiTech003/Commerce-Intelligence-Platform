import type { ApiConfig } from '../../config';
import { AnthropicLlmClient } from './anthropic.client';
import { FakeLlmClient } from './fake.client';
import type { LlmClient } from './llm';
import { OpenAiCompatibleLlmClient } from './openai.client';

export function createLlmClient(config: ApiConfig): LlmClient {
  const price = { input: config.LLM_PRICE_INPUT_PER_MTOK, output: config.LLM_PRICE_OUTPUT_PER_MTOK };
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicLlmClient({
        apiKey: config.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY,
        model: config.LLM_MODEL ?? 'claude-opus-5-5',
        baseUrl: config.LLM_BASE_URL,
        timeoutMs: config.LLM_TIMEOUT_MS,
        price,
      });
    case 'openai':
      return new OpenAiCompatibleLlmClient({
        apiKey: config.LLM_API_KEY ?? process.env.OPENAI_API_KEY,
        model: config.LLM_MODEL ?? 'gpt-4.1-mini',
        baseUrl: config.LLM_BASE_URL ?? 'https://api.openai.com',
        timeoutMs: config.LLM_TIMEOUT_MS,
        price,
      });
    default:
      return new FakeLlmClient({
        latencyMs: config.LLM_FAKE_LATENCY_MS,
        invalidFirst: config.LLM_FAKE_INVALID_FIRST,
      });
  }
}
