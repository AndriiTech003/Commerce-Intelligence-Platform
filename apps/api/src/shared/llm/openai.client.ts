import { estimateCost, LlmProviderError, type LlmClient, type LlmRequest, type LlmResponse } from './llm';

export interface OpenAiCompatibleOptions {
  apiKey?: string | undefined;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  price?: { input?: number | undefined; output?: number | undefined };
  fetchImpl?: typeof fetch;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiCompatibleLlmClient implements LlmClient {
  readonly provider = 'openai-compatible';
  readonly model: string;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.model = options.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(
        `${this.options.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: request.maxTokens,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.prompt },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: `${request.task}_output`, strict: true, schema: request.schema },
            },
          }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new LlmProviderError(error instanceof Error ? error.message : String(error), true);
    } finally {
      clearTimeout(timer);
    }
    const body = (await response.json().catch(() => ({}))) as ChatCompletion;
    if (!response.ok)
      throw new LlmProviderError(
        `HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    const choice = body.choices?.[0];
    if (choice?.message?.refusal) throw new LlmProviderError('model declined the request', false);
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    return {
      text: choice?.message?.content ?? '',
      model: body.model ?? this.model,
      provider: this.provider,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      costUsd: estimateCost(this.model, inputTokens, outputTokens, this.options.price),
    };
  }
}
