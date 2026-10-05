import type { DecisionMade, Explanation } from '@cip/contracts';
import type { PriceQuantiles, RuleGroup } from '@cip/personalization';

export const PROFILE_STORE = Symbol('PROFILE_STORE');
export const PROFILE_SNAPSHOTS = Symbol('PROFILE_SNAPSHOTS');
export const SEGMENT_REPOSITORY = Symbol('SEGMENT_REPOSITORY');
export const RECO_STORE = Symbol('RECO_STORE');
export const CANDIDATE_QUERIES = Symbol('CANDIDATE_QUERIES');
export const DECISION_LOG = Symbol('DECISION_LOG');

export interface ProfileStore {
  read(tenantId: string, profileId: string): Promise<Record<string, string> | null>;
  restore(tenantId: string, profileId: string, raw: Record<string, string>): Promise<void>;
  dirtyTenants(): Promise<string[]>;
  popDirty(tenantId: string, count: number): Promise<string[]>;
  markDirty(tenantId: string, profileIds: string[]): Promise<void>;
  quantiles(tenantId: string): Promise<PriceQuantiles | null>;
  bumpSegmentsVersion(tenantId: string): Promise<number>;
  segmentsVersion(tenantId: string): Promise<number>;
}

export interface ProfileSnapshot {
  profileId: string;
  customerId: string | null;
  features: Record<string, unknown>;
  segments: string[];
  updatedAt: Date;
}

export interface ProfileSnapshotRepository {
  upsert(rows: ProfileSnapshot[]): Promise<void>;
  find(profileId: string): Promise<ProfileSnapshot | null>;
  findByCustomer(customerId: string): Promise<ProfileSnapshot | null>;
  recent(limit: number): Promise<ProfileSnapshot[]>;
  count(): Promise<number>;
  memberCounts(): Promise<Record<string, number>>;
  ltvOfCustomers(): Promise<number[]>;
}

export interface SegmentRecord {
  id: string;
  key: string;
  name: string;
  rules: RuleGroup;
  priority: number;
  isSystem: boolean;
}

export interface SegmentRepository {
  list(): Promise<SegmentRecord[]>;
  find(id: string): Promise<SegmentRecord | null>;
  findByKey(key: string): Promise<SegmentRecord | null>;
  insert(record: SegmentRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<SegmentRecord, 'id' | 'key' | 'isSystem'>>): Promise<void>;
  remove(id: string): Promise<boolean>;
  categories(): Promise<string[]>;
  brands(): Promise<string[]>;
}

export interface ScoredId {
  id: string;
  score: number;
}

export interface RecoStore {
  popular(tenantId: string, bucket: string, count: number): Promise<ScoredId[]>;
  cooccurring(tenantId: string, productId: string, count: number): Promise<ScoredId[]>;
  views(tenantId: string, productIds: string[]): Promise<Map<string, number>>;
  maxViews(tenantId: string): Promise<number>;
  getCached<T>(key: string): Promise<T | null>;
  setCached(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export interface CandidateRow {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  priceMinCents: number | null;
  compareAtCents: number | null;
  currency: string | null;
  categoryPath: string | null;
  imageKey: string | null;
  available: boolean;
  status: string;
  createdAt: Date;
  embedding: number[] | null;
}

export interface ProductSelectorQuery {
  categoryPath?: string | undefined;
  brands?: string[] | undefined;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  productIds?: string[] | undefined;
  q?: string | undefined;
}

export interface CandidateQueries {
  byIds(ids: string[]): Promise<CandidateRow[]>;
  nearest(vector: number[], limit: number, excludeIds: string[]): Promise<ScoredId[]>;
  embedding(productId: string): Promise<number[] | null>;
  fallbackPopular(categoryPath: string | null, limit: number): Promise<string[]>;
  select(selector: ProductSelectorQuery, limit: number): Promise<{ total: number; ids: string[] }>;
  catalogQuantiles(): Promise<PriceQuantiles>;
  categoryNames(): Promise<Record<string, string>>;
}

export interface DecisionRecord {
  tenantId: string;
  profileId: string;
  decisionId: string;
  placement: string;
  segmentKey: string;
  campaignId: string | null;
  creativeId: string | null;
  policy: string;
  explanation: Explanation | Record<string, unknown>;
}

export interface DecisionLog {
  record(decision: DecisionMade): Promise<void>;
  get(decisionId: string): Promise<DecisionRecord | null>;
}
