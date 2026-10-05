import { utcDay, type FeedItem, type LiveTick, type RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import { counter } from '@cip/observability';
import { feedLabel, type PipelineEvent } from './mapping';

const TTL = 600;
const published = counter('realtime_ticks_published_total', 'Realtime ticks published to Redis');

export class RealtimeAggregator {
  private readonly feedBudget = new Map<string, { second: number; used: number }>();
  private readonly activeTenants = new Map<string, number>();

  constructor(
    private readonly redis: Redis,
    private readonly keys: RedisKeys,
    private readonly feedPerSecond: number,
  ) {}

  tenants(): string[] {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [tenant, seen] of this.activeTenants) if (seen < cutoff) this.activeTenants.delete(tenant);
    return [...this.activeTenants.keys()];
  }

  private takeFeedSlot(tenantId: string, second: number): boolean {
    const budget = this.feedBudget.get(tenantId);
    if (!budget || budget.second !== second) {
      this.feedBudget.set(tenantId, { second, used: 1 });
      return true;
    }
    if (budget.used >= this.feedPerSecond) return false;
    budget.used += 1;
    return true;
  }

  async apply(item: PipelineEvent): Promise<void> {
    const event = item.event;
    const tenantId = event.tenant_id;
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const min = Math.floor(sec / 60);
    const day = utcDay();
    this.activeTenants.set(tenantId, now);
    const pipeline = this.redis.pipeline();
    const evKey = this.keys.eventsPerSecond(tenantId, sec);
    pipeline.hincrby(evKey, event.event_type, 1).expire(evKey, TTL);
    pipeline.zadd(this.keys.activeTenants(), now, tenantId);
    let revenue: number | null = null;
    let productId: string | null = null;
    let country: string | null = null;
    if (item.kind === 'track') {
      const profile = item.event.customer_id ?? item.event.anonymous_id;
      if (profile) {
        const activeKey = this.keys.active(tenantId, min);
        pipeline.pfadd(activeKey, profile).expire(activeKey, TTL);
      }
      const props = item.event.properties as Record<string, unknown>;
      productId = typeof props.product_id === 'string' ? props.product_id : null;
      country = item.event.context?.country ?? null;
    } else if (item.event.event_type === 'order.paid') {
      revenue = item.event.properties.amount_cents;
      const revenueKey = this.keys.revenue(tenantId, day);
      const ordersKey = this.keys.ordersToday(tenantId, day);
      pipeline.incrby(revenueKey, revenue).expire(revenueKey, 48 * 3600);
      pipeline.incr(ordersKey).expire(ordersKey, 48 * 3600);
    }
    if (this.takeFeedSlot(tenantId, sec)) {
      const feedItem: FeedItem = {
        eventId: event.event_id,
        eventType: event.event_type,
        occurredAt: event.occurred_at,
        country,
        label: feedLabel(item),
        productId,
        revenueCents: revenue,
      };
      const feedKey = this.keys.feed(tenantId);
      pipeline
        .lpush(feedKey, JSON.stringify(feedItem))
        .ltrim(feedKey, 0, 49)
        .expire(feedKey, 7 * 86400);
      pipeline.publish(
        this.keys.eventsChannel(tenantId),
        JSON.stringify({ type: 'event', tenantId, item: feedItem }),
      );
    }
    await pipeline.exec();
  }

  async tick(nowMs = Date.now()): Promise<number> {
    const sec = Math.floor(nowMs / 1000) - 1;
    const min = Math.floor((sec + 1) / 60);
    const day = utcDay(new Date(nowMs));
    let count = 0;
    for (const tenantId of this.tenants()) {
      const guard = await this.redis.set(this.keys.tickGuard(tenantId, sec), '1', 'EX', 10, 'NX');
      if (guard !== 'OK') continue;
      const minuteKeys = Array.from({ length: 5 }, (_, i) => this.keys.active(tenantId, min - i));
      const [byTypeRaw, active, revenue, orders] = await Promise.all([
        this.redis.hgetall(this.keys.eventsPerSecond(tenantId, sec)),
        this.redis.pfcount(...minuteKeys),
        this.redis.get(this.keys.revenue(tenantId, day)),
        this.redis.get(this.keys.ordersToday(tenantId, day)),
      ]);
      const byType = Object.fromEntries(Object.entries(byTypeRaw).map(([k, v]) => [k, Number(v)]));
      const tick: LiveTick = {
        type: 'tick',
        tenantId,
        ts: sec * 1000,
        eventsPerSec: Object.values(byType).reduce((s, v) => s + v, 0),
        byType,
        activeVisitors: active,
        revenueTodayCents: Number(revenue ?? 0),
        ordersToday: Number(orders ?? 0),
      };
      await this.redis.publish(this.keys.tickChannel(tenantId), JSON.stringify(tick));
      published.inc();
      count += 1;
    }
    return count;
  }
}
