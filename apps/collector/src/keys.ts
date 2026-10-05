import { createHash } from 'node:crypto';
import type { RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

export interface ResolvedKey {
  id: string;
  tenantId: string;
}

export interface KeyResolver {
  resolve(rawKey: string): Promise<ResolvedKey | null>;
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export class CachedKeyResolver implements KeyResolver {
  private readonly memory = new Map<string, { value: ResolvedKey | null; expires: number }>();

  constructor(
    private readonly redis: Redis,
    private readonly keys: RedisKeys,
    private readonly pool: Pool,
    private readonly memoryTtlMs: number,
  ) {}

  async resolve(rawKey: string): Promise<ResolvedKey | null> {
    if (!/^pk_live_[0-9A-Za-z]{16,64}$/.test(rawKey)) return null;
    const hash = hashKey(rawKey);
    const hit = this.memory.get(hash);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await this.fromRedis(hash);
    this.memory.set(hash, { value, expires: Date.now() + this.memoryTtlMs });
    if (this.memory.size > 10000) this.memory.clear();
    return value;
  }

  private async fromRedis(hash: string): Promise<ResolvedKey | null> {
    const redisKey = this.keys.apiKey(hash);
    const cached = await this.redis.hgetall(redisKey);
    if (cached && Object.keys(cached).length > 0) {
      if (cached.missing === '1' || cached.revokedAt || cached.kind !== 'publishable') return null;
      return { id: cached.id!, tenantId: cached.tenantId! };
    }
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      kind: string;
      prefix: string;
      created_at: Date;
    }>(
      'select id, tenant_id, kind, prefix, created_at from api_keys where key_hash = $1 and revoked_at is null limit 1',
      [hash],
    );
    const row = rows[0];
    if (!row) {
      await this.redis.multi().hset(redisKey, { missing: '1' }).expire(redisKey, 30).exec();
      return null;
    }
    await this.redis
      .multi()
      .hset(redisKey, {
        id: row.id,
        tenantId: row.tenant_id,
        kind: row.kind,
        prefix: row.prefix,
        scopes: '',
        createdAt: String(new Date(row.created_at).getTime()),
      })
      .expire(redisKey, 300)
      .exec();
    return row.kind === 'publishable' ? { id: row.id, tenantId: row.tenant_id } : null;
  }
}
