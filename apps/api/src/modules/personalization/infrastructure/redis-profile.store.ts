import { Inject, Injectable } from '@nestjs/common';
import type { RedisKeys } from '@cip/contracts';
import { PROFILE_TTL_SECONDS, type PriceQuantiles } from '@cip/personalization';
import type { Redis } from 'ioredis';
import { KEYS, REDIS } from '../../../shared/tokens';
import type { ProfileStore } from '../application/ports';

@Injectable()
export class RedisProfileStore implements ProfileStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  async read(tenantId: string, profileId: string) {
    const hash = await this.redis.hgetall(this.keys.profile(tenantId, profileId));
    if (!hash || Object.keys(hash).length === 0) return null;
    if (hash.alias) {
      const target = await this.redis.hgetall(this.keys.profile(tenantId, hash.alias));
      return target && Object.keys(target).length > 0 ? target : null;
    }
    return hash;
  }

  async restore(tenantId: string, profileId: string, raw: Record<string, string>) {
    const key = this.keys.profile(tenantId, profileId);
    const entries = Object.entries(raw).filter(([, v]) => typeof v === 'string');
    if (entries.length === 0) return;
    const created = await this.redis.hsetnx(key, 'pid', raw.pid ?? profileId);
    if (created === 0) return;
    await this.redis.multi().hset(key, Object.fromEntries(entries)).expire(key, PROFILE_TTL_SECONDS).exec();
  }

  dirtyTenants() {
    return this.redis.smembers(this.keys.profileDirtyTenants());
  }

  async popDirty(tenantId: string, count: number) {
    const result = await this.redis.spop(this.keys.profileDirty(tenantId), count);
    return Array.isArray(result) ? result : result ? [result] : [];
  }

  async markDirty(tenantId: string, profileIds: string[]) {
    if (profileIds.length === 0) return;
    await this.redis.sadd(this.keys.profileDirty(tenantId), ...profileIds);
    await this.redis.sadd(this.keys.profileDirtyTenants(), tenantId);
  }

  async quantiles(tenantId: string): Promise<PriceQuantiles | null> {
    const hash = await this.redis.hgetall(this.keys.priceQuantiles(tenantId));
    const entries = Object.entries(hash ?? {});
    if (entries.length === 0) return null;
    const out: PriceQuantiles = {};
    for (const [key, value] of entries) {
      const [a, b] = value.split(':').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) out[key] = [a!, b!];
    }
    return out;
  }

  bumpSegmentsVersion(tenantId: string) {
    return this.redis.incr(this.keys.segmentsVersion(tenantId));
  }

  async segmentsVersion(tenantId: string) {
    return Number((await this.redis.get(this.keys.segmentsVersion(tenantId))) ?? 0);
  }
}
