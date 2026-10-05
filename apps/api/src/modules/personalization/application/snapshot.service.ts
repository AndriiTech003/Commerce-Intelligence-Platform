import { Inject, Injectable } from '@nestjs/common';
import { counter } from '@cip/observability';
import { parseProfileHash } from '@cip/personalization';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  PROFILE_SNAPSHOTS,
  PROFILE_STORE,
  type ProfileSnapshot,
  type ProfileSnapshotRepository,
  type ProfileStore,
} from './ports';
import { ProfileService } from './profile.service';
import { SegmentService } from './segment.service';

const snapshotted = counter('profile_snapshots_total', 'Profiles snapshotted to Postgres');

@Injectable()
export class ProfileSnapshotService {
  constructor(
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    @Inject(PROFILE_SNAPSHOTS) private readonly snapshots: ProfileSnapshotRepository,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(SegmentService) private readonly segments: SegmentService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async flushTenant(tenantId: string, batch = 500, maxProfiles = Number.POSITIVE_INFINITY): Promise<number> {
    let total = 0;
    for (;;) {
      const ids = await this.store.popDirty(tenantId, Math.max(1, Math.min(batch, maxProfiles - total)));
      if (ids.length === 0) break;
      const now = Date.now();
      const rows = new Map<string, ProfileSnapshot>();
      for (const id of ids) {
        const raw = await this.store.read(tenantId, id);
        if (!raw) continue;
        const state = parseProfileHash(id, raw);
        const features = await this.profiles.features(tenantId, state, now);
        const memberships = await this.segments.evaluate(tenantId, features, now);
        rows.set(state.profileId, {
          profileId: state.profileId,
          customerId: state.customerId,
          features: { ...features, raw },
          segments: memberships.map((m) => m.key),
          updatedAt: new Date(now),
        });
      }
      try {
        await this.uow.runForTenant(tenantId, () => this.snapshots.upsert([...rows.values()]));
      } catch (error) {
        await this.store.markDirty(tenantId, ids);
        throw error;
      }
      total += rows.size;
      snapshotted.inc(rows.size);
      if (ids.length < batch || total >= maxProfiles) break;
    }
    return total;
  }

  async flushAll(): Promise<number> {
    let total = 0;
    for (const tenantId of await this.store.dirtyTenants()) total += await this.flushTenant(tenantId);
    return total;
  }
}
