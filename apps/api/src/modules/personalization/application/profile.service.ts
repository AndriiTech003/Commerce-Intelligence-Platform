import { Inject, Injectable } from '@nestjs/common';
import {
  decayedMap,
  emptyProfile,
  intentFromState,
  isEmptyProfile,
  parseProfileHash,
  profileFeatures,
  profileSignals,
  type FeatureMap,
  type PriceQuantiles,
  type ProfileState,
} from '@cip/personalization';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  CANDIDATE_QUERIES,
  PROFILE_SNAPSHOTS,
  PROFILE_STORE,
  type CandidateQueries,
  type ProfileSnapshotRepository,
  type ProfileStore,
} from './ports';
import { SegmentService } from './segment.service';

export interface LoadedProfile {
  profileId: string;
  state: ProfileState;
  source: 'live' | 'snapshot' | 'none';
  updatedAt: Date | null;
}

@Injectable()
export class ProfileService {
  private readonly quantileCache = new Map<string, { value: PriceQuantiles; expires: number }>();
  private readonly namesCache = new Map<string, { value: Record<string, string>; expires: number }>();

  constructor(
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    @Inject(PROFILE_SNAPSHOTS) private readonly snapshots: ProfileSnapshotRepository,
    @Inject(CANDIDATE_QUERIES) private readonly candidates: CandidateQueries,
    @Inject(SegmentService) private readonly segments: SegmentService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async load(tenantId: string, profileId: string): Promise<LoadedProfile> {
    const raw = await this.store.read(tenantId, profileId);
    if (raw) {
      const state = parseProfileHash(profileId, raw);
      return {
        profileId: state.profileId,
        state,
        source: 'live',
        updatedAt: state.lastSeenAt ? new Date(state.lastSeenAt) : null,
      };
    }
    const snapshot = await this.uow.runForTenant(tenantId, () => this.snapshots.find(profileId));
    const stored = snapshot?.features.raw;
    if (snapshot && stored && typeof stored === 'object') {
      const hash = Object.fromEntries(
        Object.entries(stored as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>;
      await this.store.restore(tenantId, profileId, hash);
      return {
        profileId,
        state: parseProfileHash(profileId, hash),
        source: 'snapshot',
        updatedAt: snapshot.updatedAt,
      };
    }
    return { profileId, state: emptyProfile(profileId), source: 'none', updatedAt: null };
  }

  async quantiles(tenantId: string): Promise<PriceQuantiles> {
    const hit = this.quantileCache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const live = await this.store.quantiles(tenantId);
    const value =
      live && Object.keys(live).length > 0
        ? live
        : await this.uow.runForTenant(tenantId, () => this.candidates.catalogQuantiles());
    this.quantileCache.set(tenantId, { value, expires: Date.now() + 60_000 });
    return value;
  }

  async categoryNames(tenantId: string): Promise<Record<string, string>> {
    const hit = this.namesCache.get(tenantId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await this.uow.runForTenant(tenantId, () => this.candidates.categoryNames());
    this.namesCache.set(tenantId, { value, expires: Date.now() + 300_000 });
    return value;
  }

  async features(tenantId: string, state: ProfileState, now = Date.now()): Promise<FeatureMap> {
    return profileFeatures(state, { now, quantiles: await this.quantiles(tenantId) });
  }

  async signals(
    tenantId: string,
    state: ProfileState,
    currency = 'USD',
    now = Date.now(),
  ): Promise<string[]> {
    const names = await this.categoryNames(tenantId);
    const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    return profileSignals(state, {
      now,
      formatPrice: (cents) => `${symbol}${Math.round(cents / 100)}`,
      categoryName: (path) => names[path]?.toLowerCase() ?? path.split('.').pop()!.replace(/_/g, ' '),
    });
  }

  async view(
    tenantId: string,
    profileId: string,
    options: { customerId?: string | null; currency?: string } = {},
  ) {
    const loaded = await this.load(tenantId, profileId);
    const now = Date.now();
    if (loaded.source === 'none' && isEmptyProfile(loaded.state)) {
      return {
        profileId,
        customerId: options.customerId ?? null,
        source: 'none' as const,
        features: {},
        affinity: { categories: [], brands: [], tones: [] },
        priceBand: null,
        priceEwmaCents: null,
        intent: 0,
        segments: [],
        signals: [],
        recentProducts: [],
        updatedAt: null,
      };
    }
    const features = await this.features(tenantId, loaded.state, now);
    const memberships = await this.segments.evaluate(tenantId, features, now);
    const top = (map: Record<string, number>, limit: number) =>
      Object.entries(map)
        .filter(([, v]) => v > 0.001)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([key, score]) => ({ key, score: Math.round(score * 1000) / 1000 }));
    return {
      profileId: loaded.profileId,
      customerId: loaded.state.customerId ?? options.customerId ?? null,
      source: loaded.source,
      features,
      affinity: {
        categories: top(decayedMap(loaded.state.categories, now), 12),
        brands: top(decayedMap(loaded.state.brands, now), 8),
        tones: top(decayedMap(loaded.state.tones, now), 4),
      },
      priceBand: (features['price.band'] as string | null) ?? null,
      priceEwmaCents: loaded.state.priceEwma === null ? null : Math.round(loaded.state.priceEwma),
      intent: intentFromState(loaded.state, now),
      segments: memberships,
      signals: await this.signals(tenantId, loaded.state, options.currency, now),
      recentProducts: loaded.state.recent.map((r) => r.pid),
      updatedAt: loaded.updatedAt?.toISOString() ?? null,
    };
  }
}
