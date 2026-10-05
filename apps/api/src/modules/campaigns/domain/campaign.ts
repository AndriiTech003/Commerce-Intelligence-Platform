import type { ProductSelector } from '@cip/contracts';
import { DomainError } from '../../../shared/errors';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'ended';
export type CreativeStatus = 'draft' | 'approved' | 'rejected' | 'active' | 'paused';

export interface Campaign {
  id: string;
  name: string;
  placement: 'home_hero' | 'pdp_sidebar' | 'cart_upsell' | 'category_banner';
  status: CampaignStatus;
  targetSegments: string[];
  productSelector: ProductSelector;
  goal: 'click' | 'conversion';
  startsAt: Date | null;
  endsAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface Creative {
  id: string;
  campaignId: string;
  headline: string;
  body: string;
  cta: string;
  tone: string | null;
  targetSegment: string | null;
  status: CreativeStatus;
  source: 'llm' | 'human';
  generation: Record<string, unknown> | null;
  guardrailFlags: string[];
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  createdAt: Date;
}

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

export const CREATIVE_TRANSITIONS: Record<CreativeStatus, CreativeStatus[]> = {
  draft: ['approved', 'rejected'],
  approved: ['active', 'paused'],
  active: ['paused'],
  paused: ['active'],
  rejected: [],
};

export function canTransition<T extends string>(map: Record<T, T[]>, from: T, to: T): boolean {
  return from === to || map[from].includes(to);
}

export function isServable(creative: Pick<Creative, 'status'>): boolean {
  return creative.status === 'active';
}

export function isLive(
  campaign: Pick<Campaign, 'status' | 'startsAt' | 'endsAt'>,
  now = new Date(),
): boolean {
  if (campaign.status !== 'active') return false;
  if (campaign.startsAt && campaign.startsAt > now) return false;
  if (campaign.endsAt && campaign.endsAt <= now) return false;
  return true;
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super('INVALID_TRANSITION', 409, message);
  }
}

export class ApprovalBlockedError extends DomainError {
  constructor(flags: string[]) {
    super(
      'APPROVAL_BLOCKED',
      409,
      `Fix the creative before approval: ${flags.join(', ')}`,
      flags.map((flag) => ({ flag })),
    );
  }
}

export class FeatureDisabledError extends DomainError {
  constructor(feature: string) {
    super('FEATURE_DISABLED', 403, `${feature} is disabled for this store`);
  }
}

export class LlmLimitError extends DomainError {
  constructor(limit: number) {
    super(
      'LLM_LIMIT_EXCEEDED',
      429,
      `Daily limit of ${limit} AI generations reached for this store`,
      undefined,
      {
        'Retry-After': String(3600),
      },
    );
  }
}

export class LlmFailedError extends DomainError {
  constructor(message: string, invalidOutput = false) {
    super(invalidOutput ? 'LLM_INVALID_OUTPUT' : 'LLM_UNAVAILABLE', invalidOutput ? 502 : 503, message);
  }
}
