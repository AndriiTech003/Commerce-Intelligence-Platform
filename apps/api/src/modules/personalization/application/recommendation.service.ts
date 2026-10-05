import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type RedisKeys } from '@cip/contracts';
import { counter, histogram } from '@cip/observability';
import {
  dot,
  decayedMap,
  isEmptyProfile,
  mergeCandidates,
  primarySegment,
  profileVectorWeights,
  rankCandidates,
  topCategories,
  weightedAverageVector,
  type FeatureMap,
  type RankCandidate,
  type RankedItem,
  type SegmentMembership,
  type Strategy,
} from '@cip/personalization';
import type { ApiConfig } from '../../../config';
import { currentContext } from '../../../shared/request-context';
import { CONFIG, KEYS } from '../../../shared/tokens';
import { IMAGE_STORAGE, type ImageStorage } from '../../catalog';
import { TenantService, UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  CANDIDATE_QUERIES,
  DECISION_LOG,
  RECO_STORE,
  type CandidateQueries,
  type CandidateRow,
  type DecisionLog,
  type RecoStore,
  type ScoredId,
} from './ports';
import { ProfileService, type LoadedProfile } from './profile.service';
import { SegmentService } from './segment.service';

export type RecommendationType = 'for_you' | 'similar' | 'bought_together' | 'cart_upsell';

const requests = counter('recommendations_total', 'Recommendation requests', ['type', 'cache', 'cold_start']);
const latency = histogram(
  'recommendation_latency_seconds',
  'Recommendation latency',
  ['type'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
);

export function currentProfileId(): string | null {
  const ctx = currentContext();
  if (ctx?.actor?.type === 'customer' && ctx.actor.id) return ctx.actor.id;
  return ctx?.anonymousId ?? null;
}

export interface ProductCard {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  priceMinCents: number | null;
  compareAtCents: number | null;
  currency: string;
  categoryPath: string | null;
  imageUrl: string | null;
  available: boolean;
}

export interface RankedCard extends ProductCard {
  score: number;
  strategies: string[];
  contributions: RankedItem['contributions'];
}

export interface ProfileContext {
  tenantId: string;
  profile: LoadedProfile;
  features: FeatureMap;
  memberships: SegmentMembership[];
  coldStart: boolean;
}

@Injectable()
export class RecommendationService {
  private readonly rowCache = new Map<string, { row: CandidateRow; expires: number }>();

  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(SegmentService) private readonly segments: SegmentService,
    @Inject(RECO_STORE) private readonly store: RecoStore,
    @Inject(CANDIDATE_QUERIES) private readonly queries: CandidateQueries,
    @Inject(DECISION_LOG) private readonly decisions: DecisionLog,
    @Inject(IMAGE_STORAGE) private readonly images: ImageStorage,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  async signals(ctx: ProfileContext): Promise<string[]> {
    const slug = currentContext()?.tenantSlug;
    const currency = slug
      ? (await this.tenants.resolveStore(slug).catch(() => null))?.settings.currency
      : undefined;
    return this.profiles.signals(ctx.tenantId, ctx.profile.state, currency ?? 'USD');
  }

  async profileContext(
    tenantId: string,
    profileId: string | null,
    now = Date.now(),
  ): Promise<ProfileContext> {
    const profile = profileId
      ? await this.profiles.load(tenantId, profileId)
      : await this.profiles.load(tenantId, uuidv7());
    const features = await this.profiles.features(tenantId, profile.state, now);
    const memberships = await this.segments.evaluate(tenantId, features, now);
    return { tenantId, profile, features, memberships, coldStart: isEmptyProfile(profile.state) };
  }

  async rows(tenantId: string, ids: string[]): Promise<Map<string, CandidateRow>> {
    const now = Date.now();
    const out = new Map<string, CandidateRow>();
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const hit = this.rowCache.get(`${tenantId}:${id}`);
      if (hit && hit.expires > now) out.set(id, hit.row);
      else missing.push(id);
    }
    if (missing.length > 0) {
      const loaded = await this.uow.runForTenant(tenantId, () => this.queries.byIds(missing));
      for (const row of loaded) {
        out.set(row.id, row);
        this.rowCache.set(`${tenantId}:${row.id}`, { row, expires: now + 60_000 });
      }
      if (this.rowCache.size > 20000) this.rowCache.clear();
    }
    return out;
  }

  async popularity(tenantId: string, ids: string[]): Promise<Map<string, number>> {
    return this.store.views(tenantId, ids);
  }

  card(row: CandidateRow, currency = 'USD'): ProductCard {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      brand: row.brand,
      priceMinCents: row.priceMinCents,
      compareAtCents: row.compareAtCents,
      currency: row.currency ?? currency,
      categoryPath: row.categoryPath,
      imageUrl: row.imageKey ? this.images.publicUrl(row.imageKey) : null,
      available: row.available,
    };
  }

  private async popularIds(tenantId: string, bucket: string, count: number): Promise<ScoredId[]> {
    const live = await this.store.popular(tenantId, bucket, count);
    if (live.length > 0) return live;
    const fallback = await this.uow.runForTenant(tenantId, () =>
      this.queries.fallbackPopular(bucket === '_all' ? null : bucket, count),
    );
    return fallback.map((id, i) => ({ id, score: count - i }));
  }

  private async nearest(tenantId: string, vector: number[], limit: number, exclude: string[]) {
    return this.uow.runForTenant(tenantId, () => this.queries.nearest(vector, limit, exclude));
  }

  async gather(
    type: RecommendationType | 'campaign',
    ctx: ProfileContext,
    options: { productId?: string | undefined; campaignIds?: string[]; now: number },
  ): Promise<{ groups: Array<{ strategy: Strategy; items: ScoredId[] }>; itemVector: number[] | null }> {
    const { tenantId } = ctx;
    const state = ctx.profile.state;
    const groups: Array<{ strategy: Strategy; items: ScoredId[] }> = [];
    let itemVector: number[] | null = null;
    const productId = options.productId;
    if (type === 'campaign') {
      groups.push({
        strategy: 'campaign_selector',
        items: (options.campaignIds ?? []).map((id, i) => ({ id, score: -i })),
      });
      return { groups, itemVector };
    }
    if (type === 'for_you') {
      for (const category of topCategories(state, options.now, 3))
        groups.push({
          strategy: 'affinity_popular',
          items: await this.popularIds(tenantId, category.path, 40),
        });
      const weights = profileVectorWeights(state, options.now, 10);
      if (weights.length > 0) {
        const rows = await this.rows(
          tenantId,
          weights.map((w) => w.pid),
        );
        const vector = weightedAverageVector(
          weights.flatMap((w) => {
            const embedding = rows.get(w.pid)?.embedding;
            return embedding ? [{ vector: embedding, weight: w.weight }] : [];
          }),
        );
        if (vector)
          groups.push({ strategy: 'vector_profile', items: await this.nearest(tenantId, vector, 100, []) });
      }
      groups.push({ strategy: 'global_popular', items: await this.popularIds(tenantId, '_all', 60) });
    }
    if ((type === 'similar' || type === 'bought_together') && productId) {
      const rows = await this.rows(tenantId, [productId]);
      itemVector = rows.get(productId)?.embedding ?? null;
    }
    if (type === 'similar' && productId) {
      if (itemVector)
        groups.push({
          strategy: 'vector_item',
          items: await this.nearest(tenantId, itemVector, 80, [productId]),
        });
      const path = (await this.rows(tenantId, [productId])).get(productId)?.categoryPath ?? null;
      groups.push({ strategy: 'global_popular', items: await this.popularIds(tenantId, path ?? '_all', 30) });
    }
    if (type === 'bought_together' || type === 'cart_upsell') {
      const seeds = productId
        ? [productId]
        : state.recent
            .filter((r) => r.weight >= 3)
            .slice(0, 5)
            .map((r) => r.pid);
      for (const seed of seeds) {
        const cooc = await this.store.cooccurring(tenantId, seed, 50);
        const max = Math.max(0, ...cooc.map((c) => c.score));
        if (cooc.length > 0)
          groups.push({
            strategy: 'co_occurrence',
            items: cooc.map((c) => ({ id: c.id, score: max > 0 ? c.score / max : 0 })),
          });
      }
      if (groups.length === 0 && itemVector)
        groups.push({
          strategy: 'vector_item',
          items: await this.nearest(tenantId, itemVector, 30, productId ? [productId] : []),
        });
      groups.push({ strategy: 'global_popular', items: await this.popularIds(tenantId, '_all', 30) });
    }
    return { groups, itemVector };
  }

  async rank(
    ctx: ProfileContext,
    groups: Array<{ strategy: Strategy; items: ScoredId[] }>,
    options: { limit: number; exclude: string[]; referenceVector?: number[] | null; now: number },
  ): Promise<Array<{ ranked: RankedItem; row: CandidateRow }>> {
    const ids = [...new Set(groups.flatMap((g) => g.items.map((i) => i.id)))].slice(0, 300);
    const rows = await this.rows(ctx.tenantId, ids);
    const views = await this.store.views(ctx.tenantId, ids);
    const maxViews = Math.max(await this.store.maxViews(ctx.tenantId), ...views.values(), 0);
    const state = ctx.profile.state;
    const profileVector =
      options.referenceVector ??
      (() => {
        const weights = profileVectorWeights(state, options.now, 10);
        return weightedAverageVector(
          weights.flatMap((w) => {
            const embedding =
              rows.get(w.pid)?.embedding ?? this.rowCache.get(`${ctx.tenantId}:${w.pid}`)?.row.embedding;
            return embedding ? [{ vector: embedding, weight: w.weight }] : [];
          }),
        );
      })();
    const candidateGroups: RankCandidate[][] = groups.map((group) =>
      group.items.flatMap((item) => {
        const row = rows.get(item.id);
        if (!row) return [];
        const similarity =
          group.strategy === 'vector_profile' ||
          group.strategy === 'vector_item' ||
          group.strategy === 'co_occurrence'
            ? item.score
            : profileVector && row.embedding
              ? dot(profileVector, row.embedding)
              : null;
        return [
          {
            id: row.id,
            brand: row.brand,
            categoryPath: row.categoryPath,
            priceCents: row.priceMinCents,
            createdAt: row.createdAt.getTime(),
            embedding: row.embedding,
            strategies: [group.strategy],
            similarity,
            views7d: views.get(row.id) ?? 0,
            inStock: row.available,
            status: row.status,
          },
        ];
      }),
    );
    const ranked = rankCandidates(mergeCandidates(candidateGroups), {
      now: options.now,
      profileVector,
      affinity: decayedMap(state.categories, options.now),
      priceEwmaCents: state.priceEwma,
      maxViews,
      excludeIds: new Set(options.exclude),
      purchasedAt: state.purchased,
      limit: options.limit,
    });
    return ranked.map((r) => ({ ranked: r, row: rows.get(r.id)! }));
  }

  async recommend(input: { type: RecommendationType; productId?: string | undefined; limit: number }) {
    const ctx = currentContext();
    const tenantId = ctx?.tenantId;
    if (!tenantId) throw new Error('tenant context required');
    const timer = latency.startTimer({ type: input.type });
    const profileId = currentProfileId();
    const now = Date.now();
    const profileCtx = await this.profileContext(tenantId, profileId, now);
    const cacheKey = profileId
      ? this.keys.recoResult(
          tenantId,
          profileCtx.profile.profileId,
          input.type,
          `${input.productId ?? '-'}:${input.limit}:${profileCtx.profile.state.recoVersion}:${topCategories(
            profileCtx.profile.state,
            now,
            3,
          )
            .map((c) => c.path)
            .join('|')}`,
        )
      : null;
    if (cacheKey) {
      const cached = await this.store.getCached<Record<string, unknown>>(cacheKey);
      if (cached) {
        requests.inc({ type: input.type, cache: 'hit', cold_start: String(profileCtx.coldStart) });
        timer();
        return { ...cached, cached: true };
      }
    }
    const { groups, itemVector } = await this.gather(input.type, profileCtx, {
      productId: input.productId,
      now,
    });
    const exclude = [
      ...(input.productId ? [input.productId] : []),
      ...(input.type === 'cart_upsell' || input.type === 'bought_together'
        ? profileCtx.profile.state.recent.filter((r) => r.weight >= 3).map((r) => r.pid)
        : []),
    ];
    const ranked = await this.rank(profileCtx, groups, {
      limit: input.limit,
      exclude,
      referenceVector: input.type === 'similar' || input.type === 'bought_together' ? itemVector : null,
      now,
    });
    const decisionId = uuidv7();
    const items: RankedCard[] = ranked.map(({ ranked: r, row }) => ({
      ...this.card(row),
      score: Math.round(r.score * 10000) / 10000,
      strategies: r.strategies,
      contributions: r.contributions,
    }));
    const segment = primarySegment(profileCtx.memberships, []);
    const response = {
      decisionId,
      type: input.type,
      coldStart: profileCtx.coldStart,
      cached: false,
      items,
    };
    await this.decisions.record({
      decision_id: decisionId,
      tenant_id: tenantId,
      placement: `reco_${input.type}`,
      profile_id: profileCtx.profile.profileId,
      segment_key: segment?.key ?? '_default',
      campaign_id: null,
      creative_id: null,
      product_ids: items.map((i) => i.id),
      sampled_scores: {},
      policy: 'linear_ranking_mmr',
      decided_at: new Date(now).toISOString(),
      explanation: {
        decisionId,
        placement: `reco_${input.type}`,
        coldStart: profileCtx.coldStart,
        segment: segment ? { key: segment.key, name: segment.name, matchedRules: segment.reasons } : null,
        products: items.map((i) => ({
          id: i.id,
          title: i.title,
          score: i.score,
          strategies: i.strategies,
          contributions: i.contributions,
        })),
      },
    });
    if (cacheKey) await this.store.setCached(cacheKey, response, this.config.RECO_CACHE_SECONDS);
    requests.inc({ type: input.type, cache: 'miss', cold_start: String(profileCtx.coldStart) });
    timer();
    return response;
  }
}
