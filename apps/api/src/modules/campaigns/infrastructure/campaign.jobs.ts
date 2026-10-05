import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { RedisKeys } from '@cip/contracts';
import { counter, type Logger } from '@cip/observability';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ApiConfig } from '../../../config';
import { CONFIG, KEYS, LOGGER, REDIS } from '../../../shared/tokens';
import type { ArmState } from '@cip/personalization';
import { withRedisLock } from '../../personalization';
import { TenantDatabase } from '../../tenancy';
import {
  BANDIT_STORE,
  CAMPAIGN_REPOSITORY,
  type BanditStore,
  type CampaignRepository,
} from '../application/ports';

const snapshots = counter('bandit_snapshots_total', 'Bandit arm states snapshotted to Postgres');

@Injectable()
export class BanditSnapshotJob implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(BANDIT_STORE) private readonly bandit: BanditStore,
    @Inject(CAMPAIGN_REPOSITORY) private readonly repo: CampaignRepository,
    @Inject(TenantDatabase) private readonly db: TenantDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    if (!this.config.JOBS_ENABLED) return;
    this.timer = setInterval(
      () => void this.runOnce().catch((e: unknown) => this.logger.warn({ err: e }, 'bandit snapshot failed')),
      this.config.BANDIT_SNAPSHOT_INTERVAL_MS,
    );
  }

  runOnce(): Promise<number | null> {
    return withRedisLock(this.redis, this.keys.lock('bandit-snapshots'), 120_000, () => this.snapshotAll());
  }

  async snapshotAll(): Promise<number> {
    const campaigns = await this.db.withSystem(
      async (tx) =>
        (await tx.execute(sql`select id, tenant_id from campaigns where status in ('active', 'paused')`))
          .rows as Array<{
          id: string;
          tenant_id: string;
        }>,
    );
    let total = 0;
    for (const campaign of campaigns) {
      const rows: Array<ArmState & { campaignId: string; segmentKey: string }> = [];
      for (const segmentKey of await this.bandit.segments(campaign.id)) {
        const raw = await this.bandit.rawState(campaign.id, segmentKey);
        const ids = [...new Set(Object.keys(raw).map((f) => f.split(':')[0]!))];
        for (const arm of await this.bandit.arms(campaign.id, segmentKey, ids))
          rows.push({ campaignId: campaign.id, segmentKey, ...arm });
      }
      await this.db.runForTenant(campaign.tenant_id, () => this.repo.insertBanditSnapshots(rows));
      total += rows.length;
    }
    snapshots.inc(total);
    return total;
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
