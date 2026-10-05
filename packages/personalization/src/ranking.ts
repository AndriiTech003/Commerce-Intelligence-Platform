import { dot } from './embeddings';

export const RANKING_WEIGHTS = {
  similarity: 0.35,
  affinity: 0.25,
  popularity: 0.15,
  priceFit: 0.15,
  freshness: 0.1,
} as const;

export type ContributionKey = keyof typeof RANKING_WEIGHTS;

export const STRATEGIES = [
  'affinity_popular',
  'vector_profile',
  'vector_item',
  'co_occurrence',
  'campaign_selector',
  'global_popular',
] as const;
export type Strategy = (typeof STRATEGIES)[number];

export interface RankCandidate {
  id: string;
  brand: string | null;
  categoryPath: string | null;
  priceCents: number | null;
  createdAt: number;
  embedding: number[] | null;
  strategies: Strategy[];
  similarity?: number | null;
  views7d?: number;
  inStock?: boolean;
  status?: string;
}

export interface RankContext {
  now: number;
  profileVector?: number[] | null;
  affinity: Record<string, number>;
  priceEwmaCents: number | null;
  maxViews: number;
  excludeIds?: Set<string>;
  purchasedAt?: Record<string, number>;
  limit: number;
  brandCap?: number;
  lambda?: number;
  freshnessDays?: number;
}

export interface RankedItem {
  id: string;
  score: number;
  strategies: Strategy[];
  contributions: Record<ContributionKey, number>;
  features: Record<ContributionKey, number>;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function affinityFor(path: string | null, affinity: Record<string, number>): number {
  if (!path) return 0;
  const parts = path.split('.');
  let best = 0;
  for (let i = 1; i <= parts.length; i++) best = Math.max(best, affinity[parts.slice(0, i).join('.')] ?? 0);
  return best;
}

export function priceFit(priceCents: number | null, ewmaCents: number | null): number {
  if (!priceCents || !ewmaCents || priceCents <= 0 || ewmaCents <= 0) return 0.5;
  return clamp01(1 - Math.abs(Math.log(priceCents / ewmaCents)) / Math.log(3));
}

export function scoreCandidate(candidate: RankCandidate, ctx: RankContext): RankedItem {
  const maxAffinity = Math.max(0, ...Object.values(ctx.affinity));
  const similarity = clamp01(
    candidate.similarity ??
      (ctx.profileVector && candidate.embedding ? dot(ctx.profileVector, candidate.embedding) : 0),
  );
  const affinity =
    maxAffinity > 0 ? clamp01(affinityFor(candidate.categoryPath, ctx.affinity) / maxAffinity) : 0;
  const popularity =
    ctx.maxViews > 0 ? clamp01(Math.log1p(candidate.views7d ?? 0) / Math.log1p(ctx.maxViews)) : 0;
  const fit = priceFit(candidate.priceCents, ctx.priceEwmaCents);
  const ageDays = (ctx.now - candidate.createdAt) / 86_400_000;
  const freshness = clamp01(1 - ageDays / (ctx.freshnessDays ?? 30));
  const features = { similarity, affinity, popularity, priceFit: fit, freshness };
  const contributions = {
    similarity: RANKING_WEIGHTS.similarity * similarity,
    affinity: RANKING_WEIGHTS.affinity * affinity,
    popularity: RANKING_WEIGHTS.popularity * popularity,
    priceFit: RANKING_WEIGHTS.priceFit * fit,
    freshness: RANKING_WEIGHTS.freshness * freshness,
  };
  const score = Object.values(contributions).reduce((s, v) => s + v, 0);
  return { id: candidate.id, score, strategies: candidate.strategies, contributions, features };
}

export function filterCandidates(candidates: RankCandidate[], ctx: RankContext): RankCandidate[] {
  const cutoff = ctx.now - 30 * 86_400_000;
  return candidates.filter((c) => {
    if (c.inStock === false) return false;
    if (c.status && c.status !== 'active') return false;
    if (ctx.excludeIds?.has(c.id)) return false;
    const bought = ctx.purchasedAt?.[c.id];
    if (bought !== undefined && bought >= cutoff) return false;
    return true;
  });
}

export function mergeCandidates(groups: RankCandidate[][]): RankCandidate[] {
  const byId = new Map<string, RankCandidate>();
  for (const group of groups) {
    for (const candidate of group) {
      const existing = byId.get(candidate.id);
      if (!existing) {
        byId.set(candidate.id, { ...candidate, strategies: [...candidate.strategies] });
        continue;
      }
      for (const s of candidate.strategies) if (!existing.strategies.includes(s)) existing.strategies.push(s);
      if ((candidate.similarity ?? -1) > (existing.similarity ?? -1))
        existing.similarity = candidate.similarity ?? null;
      existing.embedding ??= candidate.embedding;
      existing.views7d = Math.max(existing.views7d ?? 0, candidate.views7d ?? 0);
    }
  }
  return [...byId.values()];
}

export function rankCandidates(candidates: RankCandidate[], ctx: RankContext): RankedItem[] {
  const filtered = filterCandidates(candidates, ctx);
  const scored = filtered.map((c) => ({ candidate: c, ranked: scoreCandidate(c, ctx) }));
  scored.sort((a, b) => b.ranked.score - a.ranked.score || a.candidate.id.localeCompare(b.candidate.id));
  return diversify(scored, ctx);
}

function diversify(
  scored: Array<{ candidate: RankCandidate; ranked: RankedItem }>,
  ctx: RankContext,
): RankedItem[] {
  const lambda = ctx.lambda ?? 0.7;
  const brandCap = ctx.brandCap ?? 2;
  const selected: Array<{ candidate: RankCandidate; ranked: RankedItem }> = [];
  const brands = new Map<string, number>();
  const pool = [...scored];
  while (selected.length < ctx.limit && pool.length > 0) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i]!;
      const brand = item.candidate.brand ?? '';
      if (brand && (brands.get(brand) ?? 0) >= brandCap) continue;
      let maxSim = 0;
      if (item.candidate.embedding) {
        for (const chosen of selected) {
          if (chosen.candidate.embedding)
            maxSim = Math.max(maxSim, dot(item.candidate.embedding, chosen.candidate.embedding));
        }
      }
      const value = lambda * item.ranked.score - (1 - lambda) * maxSim;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const [chosen] = pool.splice(bestIndex, 1);
    selected.push(chosen!);
    const brand = chosen!.candidate.brand ?? '';
    if (brand) brands.set(brand, (brands.get(brand) ?? 0) + 1);
  }
  return selected.map((s) => s.ranked);
}
