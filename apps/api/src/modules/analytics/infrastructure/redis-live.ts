import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { utcDay, type FeedItem, type RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import { KEYS, REDIS } from '../../../shared/tokens';
import type { AnalyticsCache, LiveMetrics } from '../application/ports';

@Injectable()
export class RedisLiveMetrics implements LiveMetrics {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  async snapshot(tenantId: string, seconds: number) {
    const nowSec = Math.floor(Date.now() / 1000);
    const nowMin = Math.floor(nowSec / 60);
    const pipeline = this.redis.pipeline();
    const secs = Array.from({ length: seconds }, (_, i) => nowSec - seconds + i);
    for (const sec of secs) pipeline.hvals(this.keys.eventsPerSecond(tenantId, sec));
    const results = (await pipeline.exec()) ?? [];
    const series = secs.map((ts, index) => {
      const values = (results[index]?.[1] as string[] | undefined) ?? [];
      return { ts: ts * 1000, eventsPerSec: values.reduce((sum, v) => sum + Number(v), 0) };
    });
    const minuteKeys = Array.from({ length: 5 }, (_, i) => this.keys.active(tenantId, nowMin - i));
    const day = utcDay();
    const [active, revenue, orders, feed] = await Promise.all([
      this.redis.pfcount(...minuteKeys),
      this.redis.get(this.keys.revenue(tenantId, day)),
      this.redis.get(this.keys.ordersToday(tenantId, day)),
      this.redis.lrange(this.keys.feed(tenantId), 0, 49),
    ]);
    return {
      activeVisitors: active,
      revenueTodayCents: Number(revenue ?? 0),
      ordersToday: Number(orders ?? 0),
      series,
      feed: feed.map((item) => JSON.parse(item) as FeedItem),
    };
  }

  async issueTicket(payload: { tenantId: string; userId: string }, ttlSeconds: number) {
    const ticket = randomBytes(24).toString('base64url');
    await this.redis.set(this.keys.wsTicket(ticket), JSON.stringify(payload), 'EX', ttlSeconds);
    return ticket;
  }
}

@Injectable()
export class RedisAnalyticsCache implements AnalyticsCache {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  async wrap<T>(tenantId: string, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    if (ttlSeconds <= 0) return fn();
    const { createHash } = await import('node:crypto');
    const redisKey = this.keys.analyticsCache(tenantId, createHash('sha1').update(key).digest('hex'));
    const hit = await this.redis.get(redisKey);
    if (hit) return JSON.parse(hit) as T;
    const value = await fn();
    await this.redis.set(redisKey, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  }
}
