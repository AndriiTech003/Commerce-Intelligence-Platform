import type { ArmState } from '@cip/personalization';
import type { Campaign, Creative, CreativeStatus } from '../domain/campaign';

export const CAMPAIGN_REPOSITORY = Symbol('CAMPAIGN_REPOSITORY');
export const BANDIT_STORE = Symbol('BANDIT_STORE');
export const PROMPT_TEMPLATES = Symbol('PROMPT_TEMPLATES');
export const LLM_GUARD = Symbol('LLM_GUARD');
export const ATTRIBUTION_STORE = Symbol('ATTRIBUTION_STORE');
export const TRACK_PUBLISHER = Symbol('TRACK_PUBLISHER');

export type CampaignWrite = Omit<Campaign, 'id' | 'createdAt'>;
export type CreativeWrite = Omit<Creative, 'id' | 'createdAt'>;

export interface PromptProductRow {
  id: string;
  title: string;
  brand: string | null;
  categoryPath: string | null;
  attributes: Record<string, unknown>;
  description: string;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  prices: number[];
  savings: number[];
}

export interface CampaignRepository {
  list(): Promise<Array<Campaign & { creativeCounts: Record<string, number> }>>;
  find(id: string): Promise<Campaign | null>;
  insert(id: string, campaign: CampaignWrite): Promise<Campaign>;
  update(id: string, patch: Partial<CampaignWrite>): Promise<Campaign | null>;
  creatives(campaignId: string): Promise<Creative[]>;
  creativesByStatus(
    status: CreativeStatus,
  ): Promise<Array<Creative & { campaignName: string; placement: string }>>;
  findCreative(id: string): Promise<Creative | null>;
  insertCreative(id: string, creative: CreativeWrite): Promise<Creative>;
  updateCreative(id: string, patch: Partial<CreativeWrite>): Promise<Creative | null>;
  activateApproved(campaignId: string): Promise<number>;
  creativeByInputHash(inputHash: string): Promise<Creative[]>;
  liveCampaigns(placement: string): Promise<Array<Campaign & { creatives: Creative[] }>>;
  promptProducts(ids: string[]): Promise<PromptProductRow[]>;
  activeDiscounts(): Promise<Array<{ code: string; type: 'percent' | 'fixed'; value: number }>>;
  segmentAggregates(segmentKey: string): Promise<string[]>;
  latestBanditSnapshot(
    campaignId: string,
    segmentKey: string,
  ): Promise<
    Array<{ creativeId: string; alpha: number; beta: number; impressions: number; successes: number }>
  >;
  insertBanditSnapshots(
    rows: Array<{
      campaignId: string;
      segmentKey: string;
      creativeId: string;
      alpha: number;
      beta: number;
      impressions: number;
      successes: number;
    }>,
  ): Promise<void>;
  banditHistory(
    campaignId: string,
    since: Date,
  ): Promise<
    Array<{ snapshotAt: Date; segmentKey: string; creativeId: string; alpha: number; beta: number }>
  >;
  setOrderAttribution(orderId: string, attribution: Record<string, unknown>): Promise<boolean>;
}

export interface BanditStore {
  arms(campaignId: string, segmentKey: string, creativeIds: string[]): Promise<ArmState[]>;
  rawState(campaignId: string, segmentKey: string): Promise<Record<string, string>>;
  segments(campaignId: string): Promise<string[]>;
  restore(campaignId: string, segmentKey: string, arms: ArmState[]): Promise<boolean>;
  initArm(campaignId: string, segmentKey: string, creativeId: string): Promise<void>;
  impression(
    campaignId: string,
    segmentKey: string,
    creativeId: string,
    decisionId: string,
  ): Promise<boolean>;
  success(
    campaignId: string,
    segmentKey: string,
    creativeId: string,
    decisionId: string,
    dedupeKey: string,
  ): Promise<boolean>;
}

export interface PromptTemplates {
  load(version: string): Promise<{ system: string; user: string }>;
}

export interface LlmGuard {
  cached(hash: string): Promise<string | null>;
  remember(hash: string, text: string): Promise<void>;
  consume(tenantId: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  usage(tenantId: string): Promise<number>;
}

export interface Attribution {
  decisionId: string;
  campaignId: string;
  creativeId: string;
  segmentKey: string;
  placement: string;
  clickedAt: string;
}

export interface AttributionStore {
  remember(tenantId: string, profileIds: string[], attribution: Attribution): Promise<void>;
  lookup(tenantId: string, profileIds: string[]): Promise<Attribution | null>;
}

export interface TrackPublisher {
  publish(event: Record<string, unknown>): Promise<void>;
}
