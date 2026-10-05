import Anthropic from '@anthropic-ai/sdk';
import { estimateCost, LlmProviderError, type LlmClient, type LlmRequest, type LlmResponse } from './llm';

export interface AnthropicOptions {
  apiKey?: string | undefined;
  model: string;
  baseUrl?: string | undefined;
  timeoutMs: number;
  price?: { input?: number | undefined; output?: number | undefined };
  fetchImpl?: typeof fetch;
}

export class AnthropicLlmClient implements LlmClient {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    this.model = options.model;
    this.client = new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      timeout: options.timeoutMs,
      maxRetries: 2,
      ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
    });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
      });
      if (response.stop_reason === 'refusal') throw new LlmProviderError('model declined the request', false);
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      return {
        text,
        model: response.model,
        provider: this.provider,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        costUsd: estimateCost(this.model, inputTokens, outputTokens, this.options.price),
      };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError)
        throw new LlmProviderError(error.message, true);
      if (error instanceof Anthropic.APIConnectionError) throw new LlmProviderError(error.message, true);
      if (error instanceof Anthropic.APIError)
        throw new LlmProviderError(`${error.status} ${error.message}`, false);
      throw new LlmProviderError(error instanceof Error ? error.message : String(error), false);
    }
  }
}
