import { APPROVAL_BLOCKING_FLAGS, TONES } from '@cip/contracts';
import type { CampaignDetail, Creative, ReviewQueue } from './types';

export const CREATIVE_LIMITS = { headline: 60, body: 160, cta: 24 } as const;

export const ALL_TONES = TONES;
export type ToneValue = (typeof TONES)[number];

export const FLAG_HELP: Record<string, string> = {
  too_long: 'Text is longer than the placement allows',
  unverified_claim: 'Mentions a price or percentage that does not match a real price or active discount',
  banned_claim: 'Uses a claim from the store’s banned list',
  profanity: 'Contains profanity',
  near_duplicate: 'Almost identical to an existing creative',
  language_mismatch: 'Language does not match the store language',
  prompt_injection: 'Looks like it was influenced by instructions inside product data',
};

export function blockingFlags(flags: string[]): string[] {
  const blocking = new Set<string>(APPROVAL_BLOCKING_FLAGS);
  return flags.filter((flag) => blocking.has(flag));
}

export function isTone(value: string | null | undefined): value is ToneValue {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value);
}

export type CreativeChange = (creative: Creative) => Creative | null;
export type OptimisticApply = (creativeId: string, change: CreativeChange) => () => void;

export function patchCampaignCreatives(
  detail: CampaignDetail | undefined,
  creativeId: string,
  change: CreativeChange,
): CampaignDetail | undefined {
  if (!detail) return detail;
  return {
    ...detail,
    creatives: detail.creatives.flatMap((c) => {
      if (c.id !== creativeId) return [c];
      const next = change(c);
      return next ? [next] : [];
    }),
  };
}

export function patchReviewQueue(
  queue: ReviewQueue | undefined,
  creativeId: string,
  change: CreativeChange,
): ReviewQueue | undefined {
  if (!queue) return queue;
  return {
    ...queue,
    data: queue.data.flatMap((item) => {
      if (item.id !== creativeId) return [item];
      const next = change(item);
      return next ? [{ ...item, ...next }] : [];
    }),
  };
}

export function statusCounts(counts: Record<string, number>): Array<[string, number]> {
  const order = ['active', 'approved', 'draft', 'paused', 'rejected'];
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}
