import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Explanation, type RedisKeys } from '@cip/contracts';
import { counter, histogram } from '@cip/observability';
import {
  bucketOf,
  DEFAULT_SEGMENT,
  isHoldout,
  parseBanditHash,
  primarySegment,
  probabilityBest,
  randomSeed,
  seededRandom,
  thompsonChoose,
  uniformChoose,
  type ArmState,
} from '@cip/personalization';
import type { Redis } from 'ioredis';
import type { ApiConfig } from '../../../config';
import { currentContext } from '../../../shared/request-context';
import { CONFIG, KEYS, REDIS } from '../../../shared/tokens';
import {
  CANDIDATE_QUERIES,
  currentProfileId,
  DECISION_LOG,
  RecommendationService,
  type CandidateQueries,
  type DecisionLog,
  type ProfileContext,
  type ProductCard,
} from '../../personalization';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { isServable, type Campaign, type Creative } from '../domain/campaign';
import { BANDIT_STORE, CAMPAIGN_REPOSITORY, type BanditStore, type CampaignRepository } from './ports';

export const RESTORE_CHECK_MS = 5000;
export const P_BEST_CACHE_MS = 5000;

const decisionLatency = histogram(
  'decision_latency_seconds',
  'Decision API latency',
  ['placement'],
  [0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.25, 0.5, 1],
);
const decisionsTotal = counter('decisions_total', 'Decisions served', [
  'placement',
  'policy',
  'cold_start',
  'segment',
]);

type LiveCampaign = Campaign & { creatives: Creative[] };

export interface DecisionResult {
  decisionId: string;
  placement: string;
  campaignId: string;
  creativeId: string;
  segmentKey: string;
  policy: string;
  creative: { headline: string; body: string; cta: string; tone: string | null };
  products: ProductCard[];
}

@Injectable()
export class DecisionService {
  private readonly rng = seededRandom(randomSeed());
  private readonly campaignCache = new Map<
    string,
    { version: number; checkedAt: number; campaigns: LiveCampaign[] }
  >();
  private readonly selectorCache = new Map<string, { ids: string[]; expires: number }>();
  private readonly restoreChecked = new Map<string, number>();
  private readonly pBestCache = new Map<string, { expires: number; arms: string; values: number[] }>();

  private cachedPBest(campaignId: string, segmentKey: string, arms: ArmState[], now: number): number[] {
    const key = `${campaignId}:${segmentKey}`;
    const signature = arms.map((a) => a.creativeId).join(',');
    const hit = this.pBestCache.get(key);
    if (hit && hit.expires > now && hit.arms === signature) return hit.values;
    const values = probabilityBest(
      arms.map((a) => ({ alpha: a.alpha, beta: a.beta })),
      2000,
      this.rng,
    );
    this.pBestCache.set(key, { expires: now + P_BEST_CACHE_MS, arms: signature, values });
    if (this.pBestCache.size > 5000) this.pBestCache.clear();
    return values;
  }

  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly repo: CampaignRepository,
    @Inject(BANDIT_STORE) private readonly bandit: BanditStore,
    @Inject(RecommendationService) private readonly recommendations: RecommendationService,
    @Inject(CANDIDATE_QUERIES) private readonly candidates: CandidateQueries,
    @Inject(DECISION_LOG) private readonly decisions: DecisionLog,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  async liveCampaigns(tenantId: string, placement: string): Promise<LiveCampaign[]> {
    const key = `${tenantId}:${placement}`;
    const cached = this.campaignCache.get(key);
    const now = Date.now();
    if (cached && now - cached.checkedAt < this.config.DECISION_CACHE_MS) return cached.campaigns;
    const version = Number((await this.redis.get(this.keys.campaignsVersion(tenantId))) ?? 0);
    if (cached && cached.version === version && now - cached.checkedAt < this.config.DECISION_CACHE_MS * 15) {
      cached.checkedAt = now;
      return cached.campaigns;
    }
    const campaigns = (await this.uow.runForTenant(tenantId, () => this.repo.liveCampaigns(placement)))
      .map((c) => ({ ...c, creatives: c.creatives.filter(isServable) }))
      .filter((c) => c.creatives.length > 0);
    this.campaignCache.set(key, { version, checkedAt: now, campaigns });
    return campaigns;
  }

  private async selectorIds(tenantId: string, campaign: Campaign): Promise<string[]> {
    const key = `${tenantId}:${campaign.id}`;
    const hit = this.selectorCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.ids;
    const { ids } = await this.uow.runForTenant(tenantId, () =>
      this.candidates.select(campaign.productSelector, 100),
    );
    this.selectorCache.set(key, { ids, expires: Date.now() + 60_000 });
    return ids;
  }

  private async arms(campaign: LiveCampaign, segmentKey: string): Promise<ArmState[]> {
    const ids = campaign.creatives.map((c) => c.id);
    const raw = await this.bandit.rawState(campaign.id, segmentKey);
    if (Object.keys(raw).length > 0) return parseBanditHash(raw, ids);
    const marker = `${campaign.id}:${segmentKey}`;
    const checked = this.restoreChecked.get(marker) ?? 0;
    if (Date.now() - checked > RESTORE_CHECK_MS) {
      this.restoreChecked.set(marker, Date.now());
      if (this.restoreChecked.size > 10000) this.restoreChecked.clear();
      const snapshot = await this.uow.runForTenant(currentContext()!.tenantId!, () =>
        this.repo.latestBanditSnapshot(campaign.id, segmentKey),
      );
      if (snapshot.length > 0) {
        await this.bandit.restore(campaign.id, segmentKey, snapshot);
        return this.bandit.arms(campaign.id, segmentKey, ids);
      }
    }
    return parseBanditHash({}, ids);
  }

  async decide(input: {
    placement: string;
    productId?: string | undefined;
    limit: number;
  }): Promise<DecisionResult | null> {
    const timer = decisionLatency.startTimer({ placement: input.placement });
    const tenantId = currentContext()!.tenantId!;
    const campaigns = await this.liveCampaigns(tenantId, input.placement);
    if (campaigns.length === 0) {
      timer();
      return null;
    }
    const now = Date.now();
    const profileId = currentProfileId();
    const ctx = await this.recommendations.profileContext(tenantId, profileId, now);
    const effectiveProfile = profileId ?? ctx.profile.profileId;
    const campaign = campaigns[bucketOf(`${effectiveProfile}:${input.placement}`, campaigns.length)]!;
    const primary = primarySegment(ctx.memberships, campaign.targetSegments);
    const segmentKey = primary?.key ?? DEFAULT_SEGMENT;
    const holdout = isHoldout(bucketOf(`${effectiveProfile}:${campaign.id}`), this.config.HOLDOUT_PERCENT);
    const arms = await this.arms(campaign, segmentKey);
    const choice = holdout
      ? uniformChoose(arms, this.rng)
      : thompsonChoose(arms, this.rng, this.config.BANDIT_WARMUP);
    const creative = campaign.creatives.find((c) => c.id === choice.chosen)!;
    const products = await this.products(ctx, campaign, holdout, input, now);
    const decisionId = uuidv7();
    const explanation = await this.explain({
      decisionId,
      placement: input.placement,
      ctx,
      campaign,
      creative,
      arms,
      choice,
      segmentKey,
      holdout,
      products,
      now,
      primary,
    });
    await this.decisions.record({
      decision_id: decisionId,
      tenant_id: tenantId,
      placement: input.placement,
      profile_id: effectiveProfile,
      segment_key: segmentKey,
      campaign_id: campaign.id,
      creative_id: creative.id,
      product_ids: products.map((p) => p.card.id),
      sampled_scores: choice.samples,
      policy: choice.policy,
      decided_at: new Date(now).toISOString(),
      explanation: explanation as unknown as Record<string, unknown>,
    });
    decisionsTotal.inc({
      placement: input.placement,
      policy: choice.policy,
      cold_start: String(ctx.coldStart),
      segment: segmentKey,
    });
    timer();
    return {
      decisionId,
      placement: input.placement,
      campaignId: campaign.id,
      creativeId: creative.id,
      segmentKey,
      policy: choice.policy,
      creative: { headline: creative.headline, body: creative.body, cta: creative.cta, tone: creative.tone },
      products: products.map((p) => p.card),
    };
  }

  private async products(
    ctx: ProfileContext,
    campaign: Campaign,
    holdout: boolean,
    input: { productId?: string | undefined; limit: number },
    now: number,
  ) {
    const exclude = input.productId ? [input.productId] : [];
    if (holdout) {
      const { groups } = await this.recommendations.gather(
        'for_you',
        { ...ctx, profile: { ...ctx.profile, state: { ...ctx.profile.state, categories: {}, recent: [] } } },
        { now },
      );
      const popular = groups.filter((g) => g.strategy === 'global_popular');
      const ranked = await this.recommendations.rank(ctx, popular, { limit: input.limit, exclude, now });
      return ranked.map((r) => ({ card: this.recommendations.card(r.row), ranked: r.ranked }));
    }
    const ids = await this.selectorIds(ctx.tenantId, campaign);
    const { groups } = await this.recommendations.gather('campaign', ctx, { campaignIds: ids, now });
    const ranked = await this.recommendations.rank(ctx, groups, { limit: input.limit, exclude, now });
    return ranked.map((r) => ({ card: this.recommendations.card(r.row), ranked: r.ranked }));
  }

  private async explain(input: {
    decisionId: string;
    placement: string;
    ctx: ProfileContext;
    campaign: LiveCampaign;
    creative: Creative;
    arms: ArmState[];
    choice: { chosen: string; samples: Record<string, number>; policy: string };
    segmentKey: string;
    holdout: boolean;
    products: Array<{
      card: ProductCard;
      ranked: {
        score: number;
        strategies: string[];
        contributions: Explanation['products'][number]['contributions'];
      };
    }>;
    now: number;
    primary: { key: string; name: string; reasons: string[] } | null;
  }): Promise<Explanation> {
    const pBest = this.cachedPBest(input.campaign.id, input.segmentKey, input.arms, input.now);
    const byId = new Map(input.campaign.creatives.map((c) => [c.id, c]));
    const profileSignals = await this.signals(input.ctx);
    const chosenArm = input.arms.find((a) => a.creativeId === input.creative.id);
    const text: string[] = [];
    if (input.primary)
      text.push(
        `You are in the segment "${input.primary.name}" because ${input.primary.reasons.join(', ')}.`,
      );
    else text.push('No targeted segment matched your recent activity, so the default audience was used.');
    if (input.holdout)
      text.push(
        'You are in the 10% control group: the creative was picked at random and products are the store bestsellers.',
      );
    else if (input.choice.policy === 'warmup')
      text.push(
        `This creative is still in warm-up (${chosenArm?.impressions ?? 0} of ${this.config.BANDIT_WARMUP} impressions), so variants are shown evenly.`,
      );
    else
      text.push(
        `Thompson sampling drew a click-rate of ${(input.choice.samples[input.creative.id] ?? 0).toFixed(3)} for this creative, the highest among ${input.arms.length} variants.`,
      );
    if (input.ctx.coldStart) text.push('We do not know much about you yet, so popular products are shown.');
    return {
      decisionId: input.decisionId,
      placement: input.placement,
      decidedAt: new Date(input.now).toISOString(),
      segment: {
        key: input.segmentKey,
        name: input.primary?.name ?? 'Default audience',
        matchedRules: input.primary?.reasons ?? [],
      },
      otherSegments: input.ctx.memberships.map((m) => m.key).filter((k) => k !== input.segmentKey),
      profileSignals,
      coldStart: input.ctx.coldStart,
      creative: {
        chosen: input.creative.id,
        headline: input.creative.headline,
        tone: input.creative.tone,
        policy: input.choice.policy,
        arms: input.arms.map((arm, i) => ({
          id: arm.creativeId,
          tone: byId.get(arm.creativeId)?.tone ?? null,
          headline: byId.get(arm.creativeId)?.headline ?? '',
          impressions: arm.impressions,
          ctr: arm.impressions > 0 ? arm.successes / arm.impressions : 0,
          sampled: input.choice.samples[arm.creativeId] ?? null,
          pBest: pBest[i] ?? 0,
        })),
      },
      products: input.products.map((p) => ({
        id: p.card.id,
        title: p.card.title,
        score: Math.round(p.ranked.score * 10000) / 10000,
        strategies: p.ranked.strategies,
        contributions: p.ranked.contributions,
      })),
      text,
    };
  }

  private async signals(ctx: ProfileContext): Promise<string[]> {
    if (ctx.coldStart) return [];
    return this.recommendations.signals(ctx);
  }

  async explanation(decisionId: string, options: { profileId?: string | null } = {}) {
    const record = await this.decisions.get(decisionId);
    if (!record) return null;
    if (record.tenantId !== currentContext()?.tenantId) return null;
    if (
      options.profileId !== undefined &&
      options.profileId !== null &&
      record.profileId !== options.profileId
    )
      return null;
    return record;
  }
}
