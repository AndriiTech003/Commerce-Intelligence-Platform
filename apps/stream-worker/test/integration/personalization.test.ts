import { createClient } from '@clickhouse/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { redisKeys, uuidv7 } from '@cip/contracts';
import { AmqpClient, Publisher } from '@cip/messaging';
import { decayedScore, parseProfileHash } from '@cip/personalization';
import { loadConfig, startStreamWorker, type StreamWorker } from '../../src';

async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timeout');
}

describe('stream-worker: profiles, co-occurrence, decisions log, popular lists, ClickHouse-side dedupe', () => {
  const env = inject('env');
  const tenantId = uuidv7();
  const keys = redisKeys(env.REDIS_PREFIX);
  let worker: StreamWorker;
  let client: AmqpClient;
  let publisher: Publisher;
  let redis: Redis;
  const ch = createClient({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DATABASE });

  beforeAll(async () => {
    worker = await startStreamWorker(loadConfig({ ...env, PROFILE_FLUSH_MS: '50' }), { opsServer: false });
    client = new AmqpClient({ url: env.RABBITMQ_URL!, name: 'sw-p13n-test' });
    publisher = new Publisher(client);
    await client.start({ waitForConnection: true });
    redis = new Redis(env.REDIS_URL!);
    await waitFor(async () => publisher.ready && worker.amqp.connected);
  });

  afterAll(async () => {
    await worker.stop();
    await client.close();
    const found = await redis.keys(`${env.REDIS_PREFIX}*`);
    if (found.length) await redis.del(...found);
    redis.disconnect();
    await ch.close();
  });

  const publish = (exchange: 'track' | 'domain', body: { event_id: string; event_type: string }) =>
    publisher.publish({ exchange, routingKey: body.event_type, body, messageId: body.event_id });

  const view = (
    anonymousId: string,
    sessionId: string,
    productId: string,
    path = 'running.road_shoes',
    occurredAt = new Date(),
  ) => ({
    event_id: uuidv7(),
    event_type: 'product_viewed',
    schema_version: 1,
    tenant_id: tenantId,
    occurred_at: occurredAt.toISOString(),
    received_at: new Date().toISOString(),
    anonymous_id: anonymousId,
    session_id: sessionId,
    properties: { product_id: productId, category_path: path, price_cents: 9900, brand: 'Stridewell' },
  });

  const rows = async (query: string, params: Record<string, unknown> = {}) => {
    const result = await ch.query({ query, query_params: { t: tenantId, ...params }, format: 'JSONEachRow' });
    return result.json<Record<string, string>>();
  };

  it('builds the profile from q.profile.update and stitches identities on customer.identified', async () => {
    const anonymous = uuidv7();
    const session = uuidv7();
    const events = Array.from({ length: 5 }, () => view(anonymous, session, uuidv7()));
    for (const event of events) await publish('track', event);
    await publish('track', events[0]!);
    const state = await waitFor(async () => {
      const hash = await redis.hgetall(keys.profile(tenantId, anonymous));
      const parsed = parseProfileHash(anonymous, hash);
      return parsed.version > 0 && parsed.recent.length === 5 ? parsed : null;
    });
    expect(decayedScore(state.categories.running!, Date.now())).toBeCloseTo(5, 2);
    expect(decayedScore(state.brands.Stridewell!, Date.now())).toBeCloseTo(5, 2);
    expect(Object.keys(state.sessions)).toEqual([session]);
    const customer = uuidv7();
    await publish('domain', {
      event_id: uuidv7(),
      event_type: 'customer.identified',
      schema_version: 1,
      tenant_id: tenantId,
      occurred_at: new Date().toISOString(),
      properties: { customer_id: customer, anonymous_id: anonymous },
    } as { event_id: string; event_type: string });
    const merged = await waitFor(async () => {
      const hash = await redis.hgetall(keys.profile(tenantId, customer));
      return hash.cid === customer ? parseProfileHash(customer, hash) : null;
    });
    expect(decayedScore(merged.categories.running!, Date.now())).toBeCloseTo(5, 2);
    expect(await redis.hget(keys.profile(tenantId, anonymous), 'alias')).toBe(customer);
    expect(await redis.sismember(keys.profileDirty(tenantId), customer)).toBe(1);
  });

  it('keeps co-occurrence of products viewed in one session and bought together', async () => {
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    const anonymous = uuidv7();
    const session = uuidv7();
    await publish('track', view(anonymous, session, a));
    await waitFor(async () => (await redis.lrange(keys.recoSession(tenantId, session), 0, -1)).includes(a));
    await publish('track', view(anonymous, session, b));
    const pair = await waitFor(async () => Number(await redis.zscore(keys.recoCooc(tenantId, a), b)) || null);
    expect(pair).toBeGreaterThan(0);
    expect(Number(await redis.zscore(keys.recoCooc(tenantId, b), a))).toBeCloseTo(pair, 6);
    await publish('domain', {
      event_id: uuidv7(),
      event_type: 'order.placed',
      schema_version: 1,
      tenant_id: tenantId,
      occurred_at: new Date().toISOString(),
      properties: {
        order_id: uuidv7(),
        number: 1001,
        profile_id: anonymous,
        items: [
          { product_id: a, variant_id: uuidv7(), qty: 1, unit_price_cents: 1000, category_path: 'running' },
          { product_id: c, variant_id: uuidv7(), qty: 1, unit_price_cents: 1000, category_path: 'running' },
        ],
        total_cents: 2000,
        currency: 'USD',
      },
    } as { event_id: string; event_type: string });
    const bought = await waitFor(
      async () => Number(await redis.zscore(keys.recoCooc(tenantId, a), c)) || null,
    );
    expect(bought / pair).toBeGreaterThan(4.9);
    expect(await redis.ttl(keys.recoCooc(tenantId, a))).toBeGreaterThan(6 * 86400);
    const profile = await waitFor(async () => {
      const hash = await redis.hgetall(keys.profile(tenantId, anonymous));
      return hash.oc === '1' ? parseProfileHash(anonymous, hash) : null;
    });
    expect(profile.ltvCents).toBe(2000);
    expect(Object.keys(profile.purchased).sort()).toEqual([a, c].sort());
  });

  it('writes decision.made messages to the ClickHouse decisions log once', async () => {
    const decision = {
      decision_id: uuidv7(),
      tenant_id: tenantId,
      placement: 'home_hero',
      profile_id: uuidv7(),
      segment_key: 'runners',
      campaign_id: uuidv7(),
      creative_id: uuidv7(),
      product_ids: [uuidv7()],
      sampled_scores: { a: 0.04 },
      policy: 'thompson_sampling',
      explanation: { text: ['why'] },
      decided_at: new Date().toISOString(),
    };
    for (let i = 0; i < 2; i++)
      await publisher.publish({
        exchange: 'domain',
        routingKey: 'decision.made',
        body: decision,
        messageId: decision.decision_id,
      });
    const found = await waitFor(async () => {
      const r = await rows(
        'SELECT count() AS n, any(policy) AS policy, any(segment_key) AS seg FROM decisions WHERE tenant_id = {t:UUID}',
      );
      return Number(r[0]?.n) >= 1 ? r[0] : null;
    });
    await new Promise((r) => setTimeout(r, 800));
    const again = await rows('SELECT count() AS n FROM decisions WHERE tenant_id = {t:UUID}');
    expect(Number(again[0]!.n)).toBe(1);
    expect(found.policy).toBe('thompson_sampling');
    expect(found.seg).toBe('runners');
  });

  it('duplicates that slip past Redis are not double counted in the minute and product aggregates', async () => {
    const product = uuidv7();
    const bucket = new Date(Date.now() - 3 * 86_400_000);
    bucket.setUTCSeconds(0, 0);
    bucket.setUTCMinutes(Math.floor(Math.random() * 60));
    const events = Array.from({ length: 10 }, (_, i) =>
      view(uuidv7(), uuidv7(), product, 'hiking.boots', new Date(bucket.getTime() + i * 1000)),
    );
    for (const event of events) await publish('track', event);
    const counts = async () => {
      const [raw] = await rows(
        `SELECT count() AS n FROM events WHERE tenant_id = {t:UUID} AND product_id = {p:UUID}`,
        { p: product },
      );
      const [minute] = await rows(
        `SELECT countMerge(events) AS n FROM events_per_minute WHERE tenant_id = {t:UUID} AND event_type = 'product_viewed' AND minute = toStartOfMinute({m:DateTime64(3, 'UTC')})`,
        { m: bucket.toISOString().replace('T', ' ').replace('Z', '') },
      );
      const [daily] = await rows(
        `SELECT sum(views) AS n FROM product_stats_daily WHERE tenant_id = {t:UUID} AND product_id = {p:UUID}`,
        { p: product },
      );
      return { raw: Number(raw?.n), minute: Number(minute?.n), daily: Number(daily?.n) };
    };
    const before = await waitFor(async () => {
      const c = await counts();
      return c.raw === 10 && c.minute === 10 && c.daily === 10 ? c : null;
    });
    const dedupKeys = await redis.keys(`${env.REDIS_PREFIX}dedup:evt:*`);
    expect(dedupKeys.length).toBeGreaterThanOrEqual(10);
    await redis.del(...dedupKeys);
    for (const event of events) await publish('track', event);
    await new Promise((r) => setTimeout(r, 2500));
    expect(await counts()).toEqual(before);
    const metrics = await (await import('@cip/observability')).registry.metrics();
    expect(metrics).toMatch(/analytics_clickhouse_duplicates_total\{[^}]*\} (1\d|[2-9]\d)/);
  });

  it('refreshes popular lists, 7-day views and price quantiles from ClickHouse', async () => {
    await worker.reco.refreshPopular(true);
    await worker.reco.refreshQuantiles(true);
    const popular = await redis.zrevrange(keys.recoPopular(tenantId, '_all'), 0, -1, 'WITHSCORES');
    expect(popular.length).toBeGreaterThan(0);
    const hiking = await redis.zrevrange(keys.recoPopular(tenantId, 'hiking'), 0, 0);
    expect(hiking.length).toBe(1);
    expect(await redis.ttl(keys.recoPopular(tenantId, '_all'))).toBeGreaterThan(3000);
    const quantiles = await redis.hgetall(keys.priceQuantiles(tenantId));
    expect(quantiles.running).toMatch(/^\d+:\d+$/);
    expect(quantiles._all).toMatch(/^\d+:\d+$/);
  });
});
