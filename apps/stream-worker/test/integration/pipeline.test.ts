import { createClient } from '@clickhouse/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { redisKeys, uuidv7, utcDay } from '@cip/contracts';
import { AmqpClient, Publisher } from '@cip/messaging';
import { loadConfig, startStreamWorker, type StreamWorker } from '../../src';

async function waitFor<T>(fn: () => Promise<T | null | false>, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timeout');
}

describe('stream-worker pipeline', () => {
  const env = inject('env');
  const tenantId = uuidv7();
  const keys = redisKeys(env.REDIS_PREFIX);
  let worker: StreamWorker;
  let client: AmqpClient;
  let publisher: Publisher;
  let redis: Redis;
  const ch = createClient({ url: env.CLICKHOUSE_URL, database: env.CLICKHOUSE_DATABASE });

  beforeAll(async () => {
    worker = await startStreamWorker(loadConfig(env), { opsServer: false });
    client = new AmqpClient({ url: env.RABBITMQ_URL!, name: 'sw-test' });
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

  const track = (type: string, properties: Record<string, unknown>, id = uuidv7()) => ({
    event_id: id,
    event_type: type,
    schema_version: 1,
    tenant_id: tenantId,
    occurred_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    anonymous_id: uuidv7(),
    session_id: uuidv7(),
    context: { country: 'DE', device: 'mobile' },
    properties,
  });

  const count = async (where: string) => {
    const result = await ch.query({
      query: `SELECT count() AS n FROM events FINAL WHERE tenant_id = {t:UUID} AND ${where}`,
      query_params: { t: tenantId },
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ n: string }>();
    return Number(rows[0]?.n ?? 0);
  };

  it('dedupes an event sent three times: one ClickHouse row and one Redis increment', async () => {
    const event = track('product_viewed', {
      product_id: uuidv7(),
      category_path: 'running',
      price_cents: 1000,
      title: 'Shoe',
    });
    for (let i = 0; i < 3; i++) {
      await publisher.publish({
        exchange: 'track',
        routingKey: event.event_type,
        body: event,
        messageId: event.event_id,
      });
    }
    await waitFor(async () => (await count(`event_id = '${event.event_id}'`)) >= 1);
    await new Promise((r) => setTimeout(r, 1000));
    await ch.command({ query: 'OPTIMIZE TABLE events FINAL' });
    const raw = await ch.query({
      query: 'SELECT count() AS n FROM events WHERE event_id = {id:UUID}',
      query_params: { id: event.event_id },
      format: 'JSONEachRow',
    });
    expect(Number((await raw.json<{ n: string }>())[0]!.n)).toBe(1);
    const sec = Math.floor(Date.parse(event.occurred_at) / 1000);
    let total = 0;
    for (let s = sec - 2; s <= sec + 5; s++)
      total += Number((await redis.hget(keys.eventsPerSecond(tenantId, s), 'product_viewed')) ?? 0);
    expect(total).toBe(1);
  });

  it('ReplacingMergeTree collapses duplicates that slipped past Redis', async () => {
    const event = track('page_viewed', { page_type: 'home' });
    for (let i = 0; i < 2; i++) {
      await ch.insert({
        table: 'events',
        values: [
          {
            event_id: event.event_id,
            tenant_id: tenantId,
            event_type: 'page_viewed',
            occurred_at: '2026-01-01 00:00:00.000',
            received_at: `2026-01-01 00:00:0${i}.000`,
            profile_id: event.anonymous_id,
            anonymous_id: event.anonymous_id,
            session_id: event.session_id,
            properties: '{}',
          },
        ],
        format: 'JSONEachRow',
      });
    }
    await ch.command({ query: 'OPTIMIZE TABLE events FINAL' });
    expect(await count(`event_id = '${event.event_id}'`)).toBe(1);
  });

  it('maps domain events into analytics rows and realtime revenue', async () => {
    const orderId = uuidv7();
    const placed = {
      event_id: uuidv7(),
      event_type: 'order.placed',
      schema_version: 1,
      tenant_id: tenantId,
      occurred_at: new Date().toISOString(),
      properties: {
        order_id: orderId,
        number: 1001,
        customer_id: null,
        profile_id: uuidv7(),
        items: [
          {
            product_id: uuidv7(),
            variant_id: uuidv7(),
            qty: 2,
            unit_price_cents: 1500,
            category_path: 'running',
          },
          {
            product_id: uuidv7(),
            variant_id: uuidv7(),
            qty: 1,
            unit_price_cents: 500,
            category_path: 'hiking',
          },
        ],
        total_cents: 3500,
        currency: 'USD',
      },
    };
    const paid = {
      ...placed,
      event_id: uuidv7(),
      event_type: 'order.paid',
      properties: { order_id: orderId, amount_cents: 3500, number: 1001 },
    };
    await publisher.publish({
      exchange: 'domain',
      routingKey: 'order.placed',
      body: placed,
      messageId: placed.event_id,
    });
    await publisher.publish({
      exchange: 'domain',
      routingKey: 'order.paid',
      body: paid,
      messageId: paid.event_id,
    });
    await waitFor(async () => (await count(`order_id = '${orderId}'`)) === 4);
    expect(await count(`order_id = '${orderId}' AND event_type = 'purchase_item'`)).toBe(2);
    const revenue = await ch.query({
      query: `SELECT sum(revenue_cents) AS r FROM events FINAL WHERE order_id = {o:UUID} AND event_type = 'order_paid'`,
      query_params: { o: orderId },
      format: 'JSONEachRow',
    });
    expect(Number((await revenue.json<{ r: string }>())[0]!.r)).toBe(3500);
    await waitFor(async () => Number(await redis.get(keys.revenue(tenantId, utcDay()))) === 3500);
    expect(Number(await redis.get(keys.ordersToday(tenantId, utcDay())))).toBe(1);
    const purchases = async () => {
      const stats = await ch.query({
        query: 'SELECT sum(purchases) AS p FROM product_stats_daily WHERE tenant_id = {t:UUID}',
        query_params: { t: tenantId },
        format: 'JSONEachRow',
      });
      return Number((await stats.json<{ p: string }>())[0]!.p);
    };
    await waitFor(async () => (await purchases()) === 3, 5000).catch(() => undefined);
    expect(await purchases()).toBe(3);
  });

  it('publishes per-second ticks and a sampled feed for active tenants', async () => {
    const subscriber = new Redis(env.REDIS_URL!);
    const messages: Array<{ type: string }> = [];
    await subscriber.subscribe(keys.tickChannel(tenantId), keys.eventsChannel(tenantId));
    subscriber.on('message', (_c, m) => messages.push(JSON.parse(m)));
    const event = track('cart_item_added', {
      product_id: uuidv7(),
      variant_id: uuidv7(),
      quantity: 1,
      price_cents: 100,
      category_path: 'x',
      title: 'Thing',
    });
    await publisher.publish({
      exchange: 'track',
      routingKey: event.event_type,
      body: event,
      messageId: event.event_id,
    });
    await waitFor(
      async () => messages.some((m) => m.type === 'tick') && messages.some((m) => m.type === 'event'),
    );
    const feedItem = messages.find((m) => m.type === 'event') as unknown as { item: { label: string } };
    expect(feedItem.item.label).toContain('added Thing to cart');
    const feed = await redis.lrange(keys.feed(tenantId), 0, -1);
    expect(feed.length).toBeGreaterThan(0);
    expect(await redis.ttl(keys.feed(tenantId))).toBeGreaterThan(0);
    subscriber.disconnect();
  });

  it('routes invalid events to the DLQ as poison', async () => {
    await publisher.publish({
      exchange: 'track',
      routingKey: 'product_viewed',
      body: { event_type: 'product_viewed', bogus: true },
      messageId: uuidv7(),
    });
    const amqp = await import('amqplib');
    const model = await amqp.connect(env.RABBITMQ_URL!);
    const channel = await model.createChannel();
    await waitFor(async () => (await channel.checkQueue('q.analytics.ingest.dlq')).messageCount >= 1);
    await model.close();
  });
});
