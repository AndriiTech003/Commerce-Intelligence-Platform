import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import type { Logger } from '@cip/observability';
import { describeRule, type EmbeddingProvider } from '@cip/personalization';
import type { ApiConfig } from '../../../config';
import { NotFoundError, ValidationFailedError } from '../../../shared/errors';
import { FEATURE_FLAGS, type FeatureFlags } from '../../../shared/flags/feature-flags';
import {
  extractJson,
  LLM_CLIENT,
  llmMetrics,
  LlmProviderError,
  renderTemplate,
  type LlmClient,
} from '../../../shared/llm/llm';
import { currentContext, newContext, runWithContext } from '../../../shared/request-context';
import { CONFIG, EMBEDDINGS, LOGGER } from '../../../shared/tokens';
import { JobService } from '../../jobs';
import { OUTBOX_WRITER, type OutboxWriter } from '../../outbox';
import {
  CANDIDATE_QUERIES,
  RecommendationService,
  SegmentService,
  type CandidateQueries,
} from '../../personalization';
import { TenantService, UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  ApprovalBlockedError,
  canTransition,
  CREATIVE_TRANSITIONS,
  FeatureDisabledError,
  InvalidStateError,
  isLive,
  LlmFailedError,
  LlmLimitError,
  type Campaign,
  type Creative,
  type CreativeStatus,
} from '../domain/campaign';
import {
  blocksApproval,
  checkGuardrails,
  type GuardrailContext,
  type GuardrailResult,
} from '../domain/guardrails';
import {
  CREATIVE_JSON_SCHEMA,
  CREATIVE_PROMPT_VERSION,
  creativeOutputSchema,
  inputHash,
  promptVariables,
  type CreativeOutput,
} from '../domain/prompt';
import { CampaignService } from './campaign.service';
import {
  CAMPAIGN_REPOSITORY,
  LLM_GUARD,
  PROMPT_TEMPLATES,
  type CampaignRepository,
  type LlmGuard,
  type PromptProductRow,
  type PromptTemplates,
} from './ports';

export interface GenerateInput {
  segments: string[];
  tones: string[];
  count: number;
  async: boolean;
}

interface GenerationResult {
  creatives: Creative[];
  errors: string[];
  rejected: number;
}

@Injectable()
export class CreativeService {
  private readonly metrics = llmMetrics();

  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly repo: CampaignRepository,
    @Inject(CampaignService) private readonly campaigns: CampaignService,
    @Inject(CANDIDATE_QUERIES) private readonly candidates: CandidateQueries,
    @Inject(RecommendationService) private readonly recommendations: RecommendationService,
    @Inject(SegmentService) private readonly segments: SegmentService,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(JobService) private readonly jobs: JobService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(PROMPT_TEMPLATES) private readonly templates: PromptTemplates,
    @Inject(LLM_GUARD) private readonly guard: LlmGuard,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingProvider,
    @Inject(FEATURE_FLAGS) private readonly flags: FeatureFlags,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  private tenantId(): string {
    return currentContext()!.tenantId!;
  }

  aiEnabled(tenantId: string): boolean {
    return this.flags.aiCreatives(tenantId);
  }

  private async guardrailContext(
    campaign: Campaign,
    products: PromptProductRow[],
    excludeCreativeId?: string,
  ): Promise<Omit<GuardrailContext, 'embedding'>> {
    const tenant = await this.tenants.current();
    const [discounts, creatives] = await Promise.all([
      this.repo.activeDiscounts(),
      this.repo.creatives(campaign.id),
    ]);
    const others = creatives.filter((c) => c.id !== excludeCreativeId && c.status !== 'rejected');
    const vectors =
      others.length > 0
        ? await this.embeddings.embed(
            others.map((c) => `${c.headline} ${c.body}`),
            'document',
          )
        : [];
    return {
      priceCents: products.flatMap((p) => p.prices),
      compareAtSavingsCents: products.flatMap((p) => p.savings),
      discounts,
      bannedClaims: tenant.settings.bannedClaims,
      language: tenant.settings.language,
      existing: others.map((c, i) => ({ id: c.id, embedding: vectors[i] ?? [] })),
      untrusted: products.map((p) => p.description),
    };
  }

  private async campaignProducts(campaign: Campaign, limit = 10): Promise<PromptProductRow[]> {
    const { ids } = await this.candidates.select(campaign.productSelector, 60);
    const views = await this.recommendations.popularity(this.tenantId(), ids);
    const top = [...ids].sort((a, b) => (views.get(b) ?? 0) - (views.get(a) ?? 0)).slice(0, limit);
    return this.repo.promptProducts(top);
  }

  private async check(
    text: { headline: string; body: string; cta: string },
    ctx: Omit<GuardrailContext, 'embedding'>,
  ): Promise<GuardrailResult> {
    const [embedding] = await this.embeddings.embed([`${text.headline} ${text.body}`], 'document');
    return checkGuardrails(text, { ...ctx, embedding: embedding ?? null });
  }

  async generate(campaignId: string, input: GenerateInput) {
    const tenantId = this.tenantId();
    if (!this.aiEnabled(tenantId)) throw new FeatureDisabledError('AI creatives');
    const campaign = await this.uow.run(() => this.repo.find(campaignId));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    const known = new Set((await this.segments.compiledFor(tenantId)).map((s) => s.key));
    const unknown = input.segments.filter((s) => s !== '_default' && !known.has(s));
    if (unknown.length > 0) throw new ValidationFailedError(`Unknown segments: ${unknown.join(', ')}`);
    const jobId = await this.jobs.create('creative_generation', input.segments.length, 'running');
    const ctx = currentContext()!;
    const run = () =>
      this.runGeneration(tenantId, jobId, campaign, input).catch(async (error: unknown) => {
        await this.jobs.update(tenantId, jobId, {
          status: 'failed',
          finishedAt: new Date(),
          result: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      });
    if (input.async) {
      const background = newContext({ requestId: ctx.requestId, tenantId, actor: ctx.actor });
      setImmediate(() => {
        void runWithContext(background, run).catch((error: unknown) =>
          this.logger.warn({ err: error, jobId }, 'creative generation failed'),
        );
      });
      return { jobId, status: 'running', creatives: [], errors: [] };
    }
    const result = await run();
    return {
      jobId,
      status: 'completed',
      creatives: result.creatives.map((c) => this.campaigns.creativeView(c)),
      errors: result.errors,
    };
  }

  private async callLlm(
    tenantId: string,
    system: string,
    prompt: string,
    context: Record<string, unknown>,
  ): Promise<{ output: CreativeOutput; meta: Record<string, unknown> }> {
    const hash = inputHash({ promptVersion: CREATIVE_PROMPT_VERSION, model: this.llm.model, system, prompt });
    const cached = await this.guard.cached(hash);
    if (cached) {
      const parsed = creativeOutputSchema.safeParse(extractJson(cached));
      if (parsed.success) {
        this.metrics.requests.inc({ provider: this.llm.provider, task: 'creative', outcome: 'cache_hit' });
        return {
          output: parsed.data,
          meta: {
            inputHash: hash,
            cached: true,
            latencyMs: 0,
            tokens: { input: 0, output: 0 },
            costUsd: 0,
            attempts: 0,
          },
        };
      }
    }
    const tenant = await this.tenants.byId(tenantId);
    const limit = tenant.settings.aiCreativesDailyLimit ?? this.config.LLM_DAILY_LIMIT;
    const quota = await this.guard.consume(tenantId, limit);
    if (!quota.allowed) {
      this.metrics.requests.inc({ provider: this.llm.provider, task: 'creative', outcome: 'limited' });
      throw new LlmLimitError(limit);
    }
    let currentPrompt = prompt;
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyMs = 0;
    let costUsd = 0;
    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const timer = this.metrics.latency.startTimer({ provider: this.llm.provider, task: 'creative' });
      let text: string;
      try {
        const response = await this.llm.complete({
          task: 'creative',
          system,
          prompt: currentPrompt,
          schema: CREATIVE_JSON_SCHEMA,
          maxTokens: 2000,
          context,
        });
        text = response.text;
        inputTokens += response.inputTokens;
        outputTokens += response.outputTokens;
        latencyMs += response.latencyMs;
        costUsd += response.costUsd;
      } catch (error) {
        this.metrics.requests.inc({ provider: this.llm.provider, task: 'creative', outcome: 'error' });
        throw new LlmFailedError(error instanceof LlmProviderError ? error.message : String(error));
      } finally {
        timer();
      }
      this.metrics.tokens.inc({ provider: this.llm.provider, direction: 'input' }, inputTokens);
      this.metrics.tokens.inc({ provider: this.llm.provider, direction: 'output' }, outputTokens);
      let parsed: ReturnType<typeof creativeOutputSchema.safeParse>;
      try {
        parsed = creativeOutputSchema.safeParse(extractJson(text));
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'invalid JSON';
        parsed = creativeOutputSchema.safeParse(null);
      }
      if (parsed.success) {
        this.metrics.requests.inc({
          provider: this.llm.provider,
          task: 'creative',
          outcome: attempt === 1 ? 'ok' : 'ok_after_retry',
        });
        this.metrics.cost.inc({ provider: this.llm.provider, task: 'creative' }, costUsd);
        await this.guard.remember(hash, text);
        return {
          output: parsed.data,
          meta: {
            inputHash: hash,
            cached: false,
            latencyMs,
            tokens: { input: inputTokens, output: outputTokens },
            costUsd,
            attempts: attempt,
          },
        };
      }
      lastError ||= parsed.error.issues
        .map((i) => `${i.path.join('.') || 'output'}: ${i.message}`)
        .join('; ');
      this.metrics.requests.inc({ provider: this.llm.provider, task: 'creative', outcome: 'invalid_output' });
      currentPrompt = `${prompt}\n\nYour previous answer was rejected by the JSON schema validator: ${lastError}\nReturn only JSON that matches the schema.`;
    }
    this.metrics.cost.inc({ provider: this.llm.provider, task: 'creative' }, costUsd);
    throw new LlmFailedError(`LLM output failed validation twice: ${lastError}`, true);
  }

  private async runGeneration(
    tenantId: string,
    jobId: string,
    campaign: Campaign,
    input: GenerateInput,
  ): Promise<GenerationResult> {
    const result: GenerationResult = { creatives: [], errors: [], rejected: 0 };
    const template = await this.templates.load(CREATIVE_PROMPT_VERSION);
    let processed = 0;
    for (const segmentKey of input.segments) {
      try {
        const created = await this.uow.runForTenant(tenantId, async () => {
          const tenant = await this.tenants.byId(tenantId);
          const products = await this.campaignProducts(campaign);
          const discounts = await this.repo.activeDiscounts();
          const segment = (await this.segments.compiledFor(tenantId)).find((s) => s.key === segmentKey);
          const aggregates = await this.repo.segmentAggregates(segmentKey);
          const variables = promptVariables({
            storeName: tenant.name,
            brandVoice: tenant.settings.brandVoice,
            language: tenant.settings.language,
            currency: tenant.settings.currency,
            segment: {
              key: segmentKey,
              name: segment?.name ?? 'All shoppers',
              rules: segment ? describeRule(segment.rules) : 'everyone not matched by another target segment',
              aggregates,
            },
            tones: input.tones,
            count: input.count,
            products: products.map((p) => ({
              title: p.title,
              brand: p.brand,
              category: p.categoryPath,
              attributes: p.attributes,
              priceMinCents: p.priceMinCents,
              priceMaxCents: p.priceMaxCents,
              description: p.description,
            })),
            discounts,
            bannedClaims: tenant.settings.bannedClaims,
          });
          const system = renderTemplate(template.system, variables);
          const prompt = renderTemplate(template.user, variables);
          const { output, meta } = await this.callLlm(tenantId, system, prompt, {
            storeName: tenant.name,
            products: products.map((p) => ({ title: p.title, priceCents: p.priceMinCents, brand: p.brand })),
            tones: input.tones,
            count: input.count,
            currency: tenant.settings.currency,
            discounts,
            untrusted: variables.untrustedProducts,
            segmentKey,
          });
          const guardCtx = await this.guardrailContext(campaign, products);
          const saved: Creative[] = [];
          for (const variant of output.variants.slice(0, input.count)) {
            const check = await this.check(variant, guardCtx);
            if (check.rejected) {
              result.rejected += 1;
              result.errors.push(
                `rejected variant "${variant.headline.slice(0, 40)}": ${check.details.join('; ')}`,
              );
              continue;
            }
            const tone = ['performance', 'lifestyle', 'value', 'premium'].includes(variant.tone)
              ? variant.tone
              : null;
            const creative = await this.repo.insertCreative(uuidv7(), {
              campaignId: campaign.id,
              headline: variant.headline,
              body: variant.body,
              cta: variant.cta,
              tone,
              targetSegment: segmentKey,
              status: 'draft',
              source: 'llm',
              generation: {
                model: this.llm.model,
                provider: this.llm.provider,
                promptVersion: CREATIVE_PROMPT_VERSION,
                rationale: variant.rationale,
                flagDetails: check.details,
                ...meta,
              },
              guardrailFlags: check.flags,
              reviewedBy: null,
              reviewedAt: null,
              reviewComment: null,
            });
            const [embedding] = await this.embeddings.embed(
              [`${creative.headline} ${creative.body}`],
              'document',
            );
            if (embedding) guardCtx.existing = [...(guardCtx.existing ?? []), { id: creative.id, embedding }];
            saved.push(creative);
          }
          return saved;
        });
        result.creatives.push(...created);
      } catch (error) {
        if (error instanceof LlmLimitError || error instanceof FeatureDisabledError) throw error;
        result.errors.push(`${segmentKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
      processed += 1;
      await this.jobs.update(tenantId, jobId, {
        processed,
        failed: result.errors.length,
        errors: result.errors.map((message, row) => ({ row: row + 1, message })),
        result: { creativeIds: result.creatives.map((c) => c.id), rejected: result.rejected },
      });
    }
    const failedAll = result.creatives.length === 0 && result.errors.length > 0;
    await this.jobs.update(tenantId, jobId, {
      status: failedAll ? 'failed' : 'completed',
      finishedAt: new Date(),
      result: { creativeIds: result.creatives.map((c) => c.id), rejected: result.rejected },
    });
    if (failedAll && result.errors.some((e) => e.includes('LLM')))
      throw new LlmFailedError(result.errors.join('; '));
    return result;
  }

  async createManual(
    campaignId: string,
    input: {
      headline: string;
      body: string;
      cta: string;
      tone?: string | null | undefined;
      targetSegment?: string | null | undefined;
    },
  ) {
    return this.uow.run(async () => {
      const campaign = await this.repo.find(campaignId);
      if (!campaign) throw new NotFoundError('Campaign', campaignId);
      const products = await this.campaignProducts(campaign, 30);
      const check = await this.check(input, await this.guardrailContext(campaign, products));
      if (check.rejected)
        throw new ValidationFailedError(
          'Creative rejected by guardrails',
          check.details.map((message) => ({ message })),
        );
      const creative = await this.repo.insertCreative(uuidv7(), {
        campaignId,
        headline: input.headline,
        body: input.body,
        cta: input.cta,
        tone: input.tone ?? null,
        targetSegment: input.targetSegment ?? null,
        status: 'draft',
        source: 'human',
        generation: { flagDetails: check.details },
        guardrailFlags: check.flags,
        reviewedBy: null,
        reviewedAt: null,
        reviewComment: null,
      });
      return this.campaigns.creativeView(creative);
    });
  }

  async update(
    id: string,
    patch: {
      headline?: string | undefined;
      body?: string | undefined;
      cta?: string | undefined;
      tone?: string | null | undefined;
      status?: 'active' | 'paused' | undefined;
    },
  ) {
    const result = await this.uow.run(async () => {
      const before = await this.repo.findCreative(id);
      if (!before) throw new NotFoundError('Creative', id);
      const contentChanged =
        patch.headline !== undefined ||
        patch.body !== undefined ||
        patch.cta !== undefined ||
        patch.tone !== undefined;
      const write: Partial<Creative> = {};
      if (contentChanged) {
        if (before.status !== 'draft')
          throw new InvalidStateError('Only draft creatives can be edited; create a new variant instead');
        const campaign = (await this.repo.find(before.campaignId))!;
        const text = {
          headline: patch.headline ?? before.headline,
          body: patch.body ?? before.body,
          cta: patch.cta ?? before.cta,
        };
        const products = await this.campaignProducts(campaign, 30);
        const check = await this.check(text, await this.guardrailContext(campaign, products, id));
        if (check.rejected)
          throw new ValidationFailedError(
            'Creative rejected by guardrails',
            check.details.map((message) => ({ message })),
          );
        Object.assign(write, text, {
          guardrailFlags: check.flags,
          generation: {
            ...(before.generation ?? {}),
            flagDetails: check.details,
            editedAt: new Date().toISOString(),
          },
        });
        if (patch.tone !== undefined) write.tone = patch.tone;
      }
      if (patch.status) {
        if (!canTransition(CREATIVE_TRANSITIONS, before.status, patch.status))
          throw new InvalidStateError(`Creative cannot go from ${before.status} to ${patch.status}`);
        write.status = patch.status;
      }
      const after = (await this.repo.updateCreative(id, write))!;
      return { before: this.campaigns.creativeView(before), after: this.campaigns.creativeView(after) };
    });
    if (patch.status) await this.campaigns.bumpVersion();
    return result;
  }

  async review(id: string, decision: 'approve' | 'reject', comment: string | undefined) {
    const actor = currentContext()?.actor;
    const result = await this.uow.run(async () => {
      const before = await this.repo.findCreative(id);
      if (!before) throw new NotFoundError('Creative', id);
      if (before.status !== 'draft')
        throw new InvalidStateError(`Creative is ${before.status}, only drafts can be reviewed`);
      let status: CreativeStatus = 'rejected';
      if (decision === 'approve') {
        const blocking = blocksApproval(before.guardrailFlags);
        if (blocking.length > 0) throw new ApprovalBlockedError(blocking);
        const campaign = (await this.repo.find(before.campaignId))!;
        status = isLive(campaign) ? 'active' : 'approved';
      }
      const after = (await this.repo.updateCreative(id, {
        status,
        reviewedBy: actor?.type === 'user' ? actor.id : null,
        reviewedAt: new Date(),
        reviewComment: comment ?? null,
      }))!;
      if (decision === 'approve')
        await this.outbox.append({
          aggregateType: 'creative',
          aggregateId: id,
          eventType: 'creative.approved',
          payload: { creative_id: id, campaign_id: before.campaignId },
        });
      return { before: this.campaigns.creativeView(before), after: this.campaigns.creativeView(after) };
    });
    await this.campaigns.bumpVersion();
    return result;
  }

  async reviewQueue() {
    const rows = await this.uow.run(() => this.repo.creativesByStatus('draft'));
    return {
      data: rows.map((r) => ({
        ...this.campaigns.creativeView(r),
        campaignName: r.campaignName,
        placement: r.placement,
      })),
    };
  }

  async usage() {
    const tenantId = this.tenantId();
    const tenant = await this.tenants.current();
    return {
      aiCreatives: this.aiEnabled(tenantId),
      flags: this.flags.state(),
      llm: {
        provider: this.llm.provider,
        model: this.llm.model,
        usedToday: await this.guard.usage(tenantId),
        dailyLimit: tenant.settings.aiCreativesDailyLimit,
      },
    };
  }
}
