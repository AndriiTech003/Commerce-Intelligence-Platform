import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Permission, RedisKeys } from '@cip/contracts';
import type { ApiConfig } from '../../../config';
import { CONFIG, KEYS, REDIS } from '../../../shared/tokens';
import type { ApiKeyKind, ApiKeyRecord } from '../domain/api-key';
import type { ApiKeyCache, RateLimitResult, StorefrontRateLimiter } from '../application/ports';

@Injectable()
export class RedisApiKeyCache implements ApiKeyCache {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  async get(hash: string): Promise<ApiKeyRecord | null | undefined> {
    const data = await this.redis.hgetall(this.keys.apiKey(hash));
    if (!data || Object.keys(data).length === 0) return undefined;
    if (data.missing === '1') return null;
    return {
      id: data.id!,
      tenantId: data.tenantId!,
      kind: data.kind as ApiKeyKind,
      prefix: data.prefix ?? '',
      scopes: (data.scopes ? data.scopes.split(',').filter(Boolean) : []) as Permission[],
      createdAt: new Date(Number(data.createdAt ?? 0)),
      lastUsedAt: null,
      revokedAt: data.revokedAt ? new Date(Number(data.revokedAt)) : null,
    };
  }

  async set(hash: string, record: ApiKeyRecord | null): Promise<void> {
    const key = this.keys.apiKey(hash);
    const value = record
      ? {
          id: record.id,
          tenantId: record.tenantId,
          kind: record.kind,
          prefix: record.prefix,
          scopes: record.scopes.join(','),
          createdAt: String(record.createdAt.getTime()),
          ...(record.revokedAt ? { revokedAt: String(record.revokedAt.getTime()) } : {}),
        }
      : { missing: '1' };
    await this.redis
      .multi()
      .del(key)
      .hset(key, value)
      .expire(key, record ? 300 : 30)
      .exec();
  }

  async invalidate(hash: string): Promise<void> {
    await this.redis.del(this.keys.apiKey(hash));
  }
}

@Injectable()
export class RedisStorefrontRateLimiter implements StorefrontRateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  async hit(subject: string): Promise<RateLimitResult> {
    const now = Date.now();
    const window = Math.floor(now / 60000);
    const key = this.keys.rateLimit(`sf:${subject}`, window);
    const results = await this.redis.multi().incr(key).expire(key, 61).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const limit = this.config.STOREFRONT_RATE_LIMIT_PER_MIN;
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: Math.max(1, Math.ceil(((window + 1) * 60000 - now) / 1000)),
    };
  }
}
