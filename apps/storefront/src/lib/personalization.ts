import { unwrap } from '@cip/api-client';
import { api } from './browser-api';
import type {
  Contributions,
  Decision,
  DecisionExplanation,
  DecisionProduct,
  Placement,
  RecommendationItem,
  RecommendationType,
  Recommendations,
} from './types';

export type TrackProps = Record<string, unknown>;

export interface RecommendationRequest {
  type: RecommendationType;
  productId?: string;
  limit?: number;
}

export interface DecisionRequest {
  placement: Placement;
  productId?: string;
  limit?: number;
}

export const NO_STORE: RequestCache = 'no-store';

export async function fetchRecommendations(
  input: RecommendationRequest,
  signal?: AbortSignal,
): Promise<Recommendations> {
  const query = {
    type: input.type,
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  };
  return unwrap(
    await api().GET('/v1/storefront/recommendations', { params: { query }, cache: NO_STORE, signal }),
  );
}

export async function fetchDecision(input: DecisionRequest, signal?: AbortSignal): Promise<Decision | null> {
  const query = {
    placement: input.placement,
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  };
  const result = await api().GET('/v1/storefront/decisions', { params: { query }, cache: NO_STORE, signal });
  if (result.response.status === 204) return null;
  return unwrap(result) ?? null;
}

export async function fetchExplanation(
  decisionId: string,
  signal?: AbortSignal,
): Promise<DecisionExplanation> {
  return unwrap(
    await api().GET('/v1/storefront/decisions/{id}/explanation', {
      params: { path: { id: decisionId } },
      cache: NO_STORE,
      signal,
    }),
  );
}

export function adImpressionProps(decision: Decision): TrackProps {
  return {
    decision_id: decision.decisionId,
    campaign_id: decision.campaignId,
    creative_id: decision.creativeId,
    placement: decision.placement,
    segment_key: decision.segmentKey,
    policy: decision.policy,
    tone: decision.creative.tone ?? null,
  };
}

export function adClickProps(
  decision: Decision,
  target: { product: Pick<DecisionProduct, 'id' | 'categoryPath'>; position: number } | null,
): TrackProps {
  const categoryPath = (target?.product ?? decision.products[0])?.categoryPath;
  return {
    ...adImpressionProps(decision),
    target: target ? 'product' : 'cta',
    ...(target ? { product_id: target.product.id, position: target.position } : {}),
    ...(categoryPath ? { category_path: categoryPath } : {}),
  };
}

export function recommendationClickProps(
  recommendations: Pick<Recommendations, 'decisionId' | 'type'>,
  item: Pick<RecommendationItem, 'id' | 'strategies' | 'categoryPath'>,
  position: number,
): TrackProps {
  return {
    decision_id: recommendations.decisionId,
    product_id: item.id,
    position,
    strategy: item.strategies[0] ?? 'unknown',
    recommendation_type: recommendations.type,
    ...(item.categoryPath ? { category_path: item.categoryPath } : {}),
  };
}

export const CONTRIBUTION_FEATURES: ReadonlyArray<{
  key: keyof Contributions;
  label: string;
  weight: number;
}> = [
  { key: 'similarity', label: 'Similarity', weight: 0.35 },
  { key: 'affinity', label: 'Category affinity', weight: 0.25 },
  { key: 'popularity', label: 'Popularity', weight: 0.15 },
  { key: 'priceFit', label: 'Price fit', weight: 0.15 },
  { key: 'freshness', label: 'Freshness', weight: 0.1 },
];

export function contributionShares(contributions: Contributions): Array<{
  key: keyof Contributions;
  label: string;
  value: number;
  percent: number;
}> {
  return CONTRIBUTION_FEATURES.map((feature) => {
    const raw = contributions[feature.key];
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return { key: feature.key, label: feature.label, value, percent: Math.min(100, value * 100) };
  });
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}
