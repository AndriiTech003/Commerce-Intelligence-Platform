import { Inject, Injectable } from '@nestjs/common';
import type { RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { ApiConfig } from '../../../config';
import { requireTenant } from '../../../shared/http/actor';
import { extractJson, LLM_CLIENT, llmMetrics, renderTemplate, type LlmClient } from '../../../shared/llm/llm';
import { loadPromptFile, splitPromptFile } from '../../../shared/llm/prompt-files';
import { CONFIG, KEYS, REDIS } from '../../../shared/tokens';
import { TenantService, UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { previousPeriod, resolvePeriod } from '../domain/analytics';
import { ANALYTICS_STORE, PRODUCT_TITLES, type AnalyticsStore, type ProductTitles } from './ports';

export const INSIGHTS_PROMPT_VERSION = 'insights.v1';

export const insightsOutputSchema = z.object({
  observations: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        detail: z.string().min(1).max(400),
        severity: z.enum(['info', 'positive', 'warning']),
        basis: z.array(z.object({ metric: z.string(), value: z.union([z.number(), z.string()]) })).min(1),
      }),
    )
    .max(8),
});

export const INSIGHTS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['observations'],
  properties: {
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'severity', 'basis'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'positive', 'warning'] },
          basis: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['metric', 'value'],
              properties: { metric: { type: 'string' }, value: { type: ['number', 'string'] } },
            },
          },
        },
      },
    },
  },
};

export function flattenAggregates(value: unknown, prefix = '', out: Record<string, number | string> = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flattenAggregates(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof value === 'number' || typeof value === 'string') out[prefix] = value;
  return out;
}

export function groundedObservations(
  observations: z.infer<typeof insightsOutputSchema>['observations'],
  aggregates: Record<string, unknown>,
) {
  const flat = flattenAggregates(aggregates);
  return observations.filter((o) =>
    o.basis.every((b) => {
      const known = flat[b.metric];
      if (known === undefined) return b.metric.startsWith('funnel.');
      return typeof known === 'number' && typeof b.value === 'number'
        ? Math.abs(known - b.value) <= Math.max(1e-6, Math.abs(known) * 1e-3)
        : String(known) === String(b.value);
    }),
  );
}

@Injectable()
export class InsightsService {
  private readonly metrics = llmMetrics();

  constructor(
    @Inject(ANALYTICS_STORE) private readonly store: AnalyticsStore,
    @Inject(PRODUCT_TITLES) private readonly titles: ProductTitles,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  async aggregates(tenantId: string, days: number) {
    const period = resolvePeriod(undefined, undefined, days);
    const previous = previousPeriod(period);
    const [current, before, funnel, top, campaigns] = await Promise.all([
      this.store.overview(tenantId, period),
      this.store.overview(tenantId, previous),
      this.store.funnel(tenantId, period, 3600),
      this.store.topProducts(tenantId, period, 'revenue', 3),
      this.store.campaignPerformance(tenantId, period),
    ]);
    const steps = ['product_viewed', 'cart_item_added', 'checkout_started', 'order_placed'];
    const users = steps.map((_, i) =>
      funnel.filter((f) => f.level >= i + 1).reduce((s, f) => s + f.users, 0),
    );
    let biggestFunnelDrop: { from: string; to: string; rate: number } | null = null;
    for (let i = 1; i < steps.length; i++) {
      const rate = users[i - 1]! > 0 ? users[i]! / users[i - 1]! : 0;
      if (users[i - 1]! > 0 && (!biggestFunnelDrop || rate < biggestFunnelDrop.rate))
        biggestFunnelDrop = { from: steps[i - 1]!, to: steps[i]!, rate: Math.round(rate * 10000) / 10000 };
    }
    const titleMap = await this.uow.runForTenant(tenantId, () =>
      this.titles.titles(top.map((t) => t.productId)),
    );
    const best = campaigns
      .filter((c) => c.impressions >= 50)
      .map((c) => ({ ...c, ctr: c.clicks / c.impressions }))
      .sort((a, b) => b.ctr - a.ctr)[0];
    const headlines = best
      ? await this.uow.runForTenant(tenantId, () => this.titles.creativeHeadlines([best.creativeId]))
      : new Map();
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      aggregates: {
        revenueCents: current.revenueCents,
        previousRevenueCents: before.revenueCents,
        orders: current.placedOrders,
        previousOrders: before.placedOrders,
        visitors: current.visitors,
        previousVisitors: before.visitors,
        conversionRate:
          current.visitors > 0 ? Math.round((current.placedOrders / current.visitors) * 10000) / 10000 : 0,
        funnel: Object.fromEntries(steps.map((s, i) => [s, users[i] ?? 0])),
        biggestFunnelDrop,
        topProduct: top[0]
          ? {
              title: titleMap.get(top[0].productId) ?? top[0].productId,
              revenueCents: top[0].revenueCents,
              purchases: top[0].purchases,
            }
          : null,
        bestCreative: best
          ? {
              headline: headlines.get(best.creativeId) ?? best.creativeId,
              ctr: Math.round(best.ctr * 10000) / 10000,
              impressions: best.impressions,
              clicks: best.clicks,
            }
          : null,
      } as Record<string, unknown>,
    };
  }

  async insights(options: { days?: number; refresh?: boolean } = {}) {
    const tenantId = requireTenant();
    const key = this.keys.insights(tenantId);
    if (!options.refresh) {
      const cached = await this.redis.get(key);
      if (cached) return { ...(JSON.parse(cached) as Record<string, unknown>), cached: true };
    }
    const tenant = await this.tenants.byId(tenantId);
    const { period, aggregates } = await this.aggregates(tenantId, options.days ?? 7);
    const template = splitPromptFile(await loadPromptFile(INSIGHTS_PROMPT_VERSION));
    const variables = {
      storeName: tenant.name,
      currency: tenant.settings.currency,
      from: period.from,
      to: period.to,
      aggregates: JSON.stringify(aggregates, null, 2),
    };
    let observations: z.infer<typeof insightsOutputSchema>['observations'] = [];
    let prompt = renderTemplate(template.user, variables);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const timer = this.metrics.latency.startTimer({ provider: this.llm.provider, task: 'insights' });
      const response = await this.llm.complete({
        task: 'insights',
        system: renderTemplate(template.system, variables),
        prompt,
        schema: INSIGHTS_JSON_SCHEMA,
        maxTokens: 1500,
        context: { aggregates },
      });
      timer();
      this.metrics.cost.inc({ provider: this.llm.provider, task: 'insights' }, response.costUsd);
      let parsed: ReturnType<typeof insightsOutputSchema.safeParse>;
      try {
        parsed = insightsOutputSchema.safeParse(extractJson(response.text));
      } catch {
        parsed = insightsOutputSchema.safeParse(null);
      }
      if (parsed.success) {
        observations = groundedObservations(parsed.data.observations, aggregates);
        this.metrics.requests.inc({ provider: this.llm.provider, task: 'insights', outcome: 'ok' });
        break;
      }
      const lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      this.metrics.requests.inc({ provider: this.llm.provider, task: 'insights', outcome: 'invalid_output' });
      prompt = `${renderTemplate(template.user, variables)}\n\nYour previous answer failed validation: ${lastError}. Return only valid JSON.`;
    }
    const result = {
      generatedAt: new Date().toISOString(),
      model: `${this.llm.provider}:${this.llm.model}`,
      cached: false,
      period,
      observations,
      aggregates,
    };
    if (this.config.INSIGHTS_CACHE_SECONDS > 0)
      await this.redis.set(key, JSON.stringify(result), 'EX', this.config.INSIGHTS_CACHE_SECONDS);
    return result;
  }
}
