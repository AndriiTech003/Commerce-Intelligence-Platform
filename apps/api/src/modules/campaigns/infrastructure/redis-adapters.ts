import { Inject, Injectable } from '@nestjs/common';
import { EXCHANGES, MESSAGE_HEADERS, utcDay, type RedisKeys } from '@cip/contracts';
import type { Publisher } from '@cip/messaging';
import type { Redis } from 'ioredis';
import type { ApiConfig } from '../../../config';
import { CONFIG, KEYS, PUBLISHER, REDIS } from '../../../shared/tokens';
import type { Attribution, AttributionStore, LlmGuard, TrackPublisher } from '../application/ports';

@Injectable()
export class RedisLlmGuard implements LlmGuard {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  cached(hash: string) {
    return this.redis.get(this.keys.llmCache(hash));
  }

  async remember(hash: string, text: string) {
    if (this.config.LLM_CACHE_TTL_SECONDS > 0)
      await this.redis.set(this.keys.llmCache(hash), text, 'EX', this.config.LLM_CACHE_TTL_SECONDS);
  }

  async consume(tenantId: string, limit: number) {
    const key = this.keys.llmQuota(tenantId, utcDay());
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, 2 * 86400);
    if (used > limit) {
      await this.redis.decr(key);
      return { allowed: false, used: used - 1 };
    }
    return { allowed: true, used };
  }

  async usage(tenantId: string) {
    return Number((await this.redis.get(this.keys.llmQuota(tenantId, utcDay()))) ?? 0);
  }
}

export const ATTRIBUTION_TTL_SECONDS = 24 * 3600;

@Injectable()
export class RedisAttributionStore implements AttributionStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  async remember(tenantId: string, profileIds: string[], attribution: Attribution) {
    if (profileIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of new Set(profileIds))
      pipeline.set(
        this.keys.attribution(tenantId, id),
        JSON.stringify(attribution),
        'EX',
        ATTRIBUTION_TTL_SECONDS,
      );
    await pipeline.exec();
  }

  async lookup(tenantId: string, profileIds: string[]) {
    let best: Attribution | null = null;
    for (const id of new Set(profileIds)) {
      const raw = await this.redis.get(this.keys.attribution(tenantId, id));
      if (!raw) continue;
      const value = JSON.parse(raw) as Attribution;
      if (!best || Date.parse(value.clickedAt) > Date.parse(best.clickedAt)) best = value;
    }
    return best;
  }
}

@Injectable()
export class AmqpTrackPublisher implements TrackPublisher {
  constructor(@Inject(PUBLISHER) private readonly publisher: Publisher) {}

  publish(event: Record<string, unknown>) {
    return this.publisher.publish({
      exchange: EXCHANGES.track,
      routingKey: String(event.event_type),
      body: event,
      messageId: String(event.event_id),
      headers: {
        [MESSAGE_HEADERS.tenantId]: String(event.tenant_id),
        [MESSAGE_HEADERS.eventType]: String(event.event_type),
        [MESSAGE_HEADERS.schemaVersion]: 1,
        [MESSAGE_HEADERS.retryCount]: 0,
      },
    });
  }
}
