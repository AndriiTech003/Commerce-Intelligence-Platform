import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { RedisKeys } from '@cip/contracts';
import type { Logger } from '@cip/observability';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import type { ApiConfig } from '../../../config';
import { CONFIG, KEYS, LOGGER, REDIS } from '../../../shared/tokens';
import { TenantDatabase } from '../../tenancy';
import { SegmentService } from '../application/segment.service';
import { ProfileSnapshotService } from '../application/snapshot.service';

export async function withRedisLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const token = randomBytes(8).toString('hex');
  if ((await redis.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') return null;
  try {
    return await fn();
  } finally {
    if ((await redis.get(key)) === token) await redis.del(key);
  }
}

@Injectable()
export class PersonalizationJobs implements OnModuleInit, OnApplicationShutdown {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(ProfileSnapshotService) private readonly snapshots: ProfileSnapshotService,
    @Inject(SegmentService) private readonly segments: SegmentService,
    @Inject(TenantDatabase) private readonly db: TenantDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    if (!this.config.JOBS_ENABLED) return;
    this.timers.push(
      setInterval(
        () =>
          void this.snapshotOnce().catch((e: unknown) =>
            this.logger.warn({ err: e }, 'profile snapshot failed'),
          ),
        this.config.PROFILE_SNAPSHOT_INTERVAL_MS,
      ),
      setInterval(
        () => void this.vipOnce().catch((e: unknown) => this.logger.warn({ err: e }, 'vip refresh failed')),
        this.config.VIP_REFRESH_INTERVAL_MS,
      ),
    );
  }

  snapshotOnce(): Promise<number | null> {
    return withRedisLock(this.redis, this.keys.lock('profile-snapshots'), 120_000, () =>
      this.snapshots.flushAll(),
    );
  }

  vipOnce(): Promise<number | null> {
    return withRedisLock(this.redis, this.keys.lock('vip-threshold'), 120_000, async () => {
      const tenants = await this.db.withSystem(
        async (tx) =>
          (await tx.execute(sql`select id from tenants where status = 'active'`)).rows as Array<{
            id: string;
          }>,
      );
      for (const t of tenants) await this.segments.refreshVipThreshold(t.id);
      return tenants.length;
    });
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearInterval(t);
  }
}
