import { Inject, Injectable } from '@nestjs/common';
import type { RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import { KEYS, REDIS } from '../../../shared/tokens';
import type { RecoStore, ScoredId } from '../application/ports';

function pairs(flat: string[]): ScoredId[] {
  const out: ScoredId[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ id: flat[i]!, score: Number(flat[i + 1]) });
  return out;
}

@Injectable()
export class RedisRecoStore implements RecoStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  async popular(tenantId: string, bucket: string, count: number) {
    return pairs(
      await this.redis.zrevrange(this.keys.recoPopular(tenantId, bucket), 0, count - 1, 'WITHSCORES'),
    );
  }

  async cooccurring(tenantId: string, productId: string, count: number) {
    return pairs(
      await this.redis.zrevrange(this.keys.recoCooc(tenantId, productId), 0, count - 1, 'WITHSCORES'),
    );
  }

  async views(tenantId: string, productIds: string[]) {
    const out = new Map<string, number>();
    if (productIds.length === 0) return out;
    const scores = await this.redis.zmscore(this.keys.recoViews(tenantId), ...productIds);
    productIds.forEach((id, i) => out.set(id, Number(scores[i] ?? 0) || 0));
    return out;
  }

  async maxViews(tenantId: string) {
    const top = await this.redis.zrevrange(this.keys.recoViews(tenantId), 0, 0, 'WITHSCORES');
    return Number(top[1] ?? 0) || 0;
  }

  async getCached<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setCached(key: string, value: unknown, ttlSeconds: number) {
    if (ttlSeconds <= 0) return;
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
}
