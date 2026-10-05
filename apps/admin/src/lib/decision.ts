export interface DecisionArmView {
  id: string;
  tone: string | null;
  headline: string;
  impressions: number;
  ctr: number;
  sampled: number | null;
  pBest: number;
}

export interface DecisionProductView {
  id: string;
  title: string | null;
  score: number;
  strategies: string[];
  contributions: Array<{ key: string; value: number }>;
}

export interface DecisionView {
  decisionId: string;
  source: string | null;
  placement: string | null;
  policy: string | null;
  decidedAt: string | null;
  profileId: string | null;
  campaignId: string | null;
  creativeId: string | null;
  segment: { key: string; name: string | null; matchedRules: string[] };
  otherSegments: string[];
  profileSignals: string[];
  coldStart: boolean;
  chosen: { id: string | null; headline: string | null; tone: string | null };
  arms: DecisionArmView[];
  products: DecisionProductView[];
  text: string[];
}

export const CONTRIBUTION_KEYS = ['similarity', 'affinity', 'popularity', 'priceFit', 'freshness'] as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function readDecision(raw: unknown, fallbackId: string): DecisionView {
  const root = record(raw);
  const explanation = record(root.explanation);
  const segment = record(explanation.segment);
  const creative = record(explanation.creative);
  const arms = Array.isArray(creative.arms) ? creative.arms : [];
  const products = Array.isArray(explanation.products) ? explanation.products : [];
  return {
    decisionId: str(root.decisionId) ?? str(explanation.decisionId) ?? fallbackId,
    source: str(root.source),
    placement: str(root.placement) ?? str(explanation.placement),
    policy: str(root.policy) ?? str(creative.policy),
    decidedAt: str(explanation.decidedAt),
    profileId: str(root.profileId),
    campaignId: str(root.campaignId),
    creativeId: str(root.creativeId) ?? str(creative.chosen),
    segment: {
      key: str(segment.key) ?? str(root.segmentKey) ?? '_default',
      name: str(segment.name),
      matchedRules: strings(segment.matchedRules),
    },
    otherSegments: strings(explanation.otherSegments),
    profileSignals: strings(explanation.profileSignals),
    coldStart: explanation.coldStart === true,
    chosen: { id: str(creative.chosen), headline: str(creative.headline), tone: str(creative.tone) },
    arms: arms.map((value) => {
      const arm = record(value);
      return {
        id: str(arm.id) ?? '',
        tone: str(arm.tone),
        headline: str(arm.headline) ?? '',
        impressions: num(arm.impressions),
        ctr: num(arm.ctr),
        sampled: typeof arm.sampled === 'number' ? arm.sampled : null,
        pBest: num(arm.pBest),
      };
    }),
    products: products.map((value) => {
      const product = record(value);
      const contributions = record(product.contributions);
      return {
        id: str(product.id) ?? '',
        title: str(product.title),
        score: num(product.score),
        strategies: strings(product.strategies),
        contributions: CONTRIBUTION_KEYS.map((key) => ({ key, value: num(contributions[key]) })),
      };
    }),
    text: strings(explanation.text),
  };
}
