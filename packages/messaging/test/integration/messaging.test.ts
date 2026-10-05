import { connect, type Channel, type ChannelModel } from 'amqplib';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MESSAGE_HEADERS, uuidv7 } from '@cip/contracts';
import {
  AmqpClient,
  BatchConsumer,
  Consumer,
  DlqAdmin,
  MemoryDeduper,
  PoisonMessageError,
  Publisher,
  RedisDeduper,
  UnroutableMessageError,
} from '../../src';

async function waitFor(fn: () => Promise<boolean> | boolean, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

describe('messaging against RabbitMQ', () => {
  let client: AmqpClient;
  let publisher: Publisher;
  let raw: ChannelModel;
  let channel: Channel;

  beforeAll(async () => {
    client = new AmqpClient({ url: inject('amqpUrl'), name: 'messaging-test' });
    publisher = new Publisher(client);
    await client.start({ waitForConnection: true });
    await waitFor(() => publisher.ready);
    raw = await connect(inject('amqpUrl'));
    channel = await raw.createChannel();
  });

  afterAll(async () => {
    await raw.close();
    await client.close();
  });

  const domainEvent = (type: string, extra: Record<string, unknown> = {}) => ({
    event_id: uuidv7(),
    event_type: type,
    schema_version: 1,
    tenant_id: uuidv7(),
    occurred_at: new Date().toISOString(),
    properties: { order_id: uuidv7(), ...extra },
  });

  it('publishes with confirms and rejects unroutable messages (mandatory + return)', async () => {
    await publisher.publish({
      exchange: 'domain',
      routingKey: 'order.fulfilled',
      body: domainEvent('order.fulfilled'),
      messageId: uuidv7(),
    });
    await expect(
      publisher.publish({ exchange: 'domain', routingKey: 'nobody.listens', body: {}, messageId: uuidv7() }),
    ).rejects.toBeInstanceOf(UnroutableMessageError);
    await channel.purgeQueue('q.notifications');
    await channel.purgeQueue('q.analytics.ingest');
  });

  it('retries a failing handler and processes it once with x-retry-count = 2', async () => {
    let attempts = 0;
    const processed: Array<{ id: string; retry: number }> = [];
    const consumer = new Consumer(client, publisher, {
      queue: 'notifications',
      consumer: 'test-retry',
      prefetch: 10,
      retry: { delays: ['5s', '5s', '5s'] },
      handler: async (_message, ctx) => {
        attempts += 1;
        if (attempts <= 2) throw new Error(`boom ${attempts}`);
        processed.push({ id: ctx.messageId, retry: ctx.retryCount });
      },
      idempotency: { deduper: new MemoryDeduper() },
    });
    consumer.start();
    const event = domainEvent('order.paid', { amount_cents: 100 });
    await publisher.publish({
      exchange: 'domain',
      routingKey: 'order.paid',
      body: event,
      messageId: event.event_id,
    });
    await waitFor(() => processed.length === 1, 30000);
    await new Promise((r) => setTimeout(r, 500));
    await consumer.stop();
    expect(processed).toEqual([{ id: event.event_id, retry: 2 }]);
    expect(attempts).toBe(3);
  }, 40000);

  it('sends poison messages straight to the DLQ and replays them after a fix', async () => {
    await channel.purgeQueue('q.notifications.dlq');
    let healthy = false;
    const handled: string[] = [];
    const consumer = new Consumer(client, publisher, {
      queue: 'notifications',
      consumer: 'test-poison',
      prefetch: 10,
      parse: (value) => {
        const event = value as { properties?: { order_id?: string } };
        if (!event.properties?.order_id) throw new PoisonMessageError('order_id missing');
        return event;
      },
      handler: async (event, ctx) => {
        if (!healthy) throw new Error('not yet');
        handled.push(ctx.messageId);
        void event;
      },
      retry: { delays: [] },
    });
    consumer.start();
    try {
      channel.sendToQueue('q.notifications', Buffer.from('not json'), { messageId: 'poison-json' });
      channel.sendToQueue('q.notifications', Buffer.from(JSON.stringify({ properties: {} })), {
        messageId: 'poison-schema',
      });
      const event = domainEvent('order.paid', { amount_cents: 1 });
      await publisher.publish({
        exchange: 'domain',
        routingKey: 'order.paid',
        body: event,
        messageId: event.event_id,
      });
      const admin = new DlqAdmin(() => client.current, publisher);
      await waitFor(
        async () => (await admin.list()).find((q) => q.queue === 'q.notifications.dlq')!.messages === 3,
      );
      const peeked = await admin.peek('q.notifications.dlq', 10);
      const byId = Object.fromEntries(peeked.map((m) => [m.messageId, m]));
      expect(byId['poison-json']!.headers[MESSAGE_HEADERS.errorKind]).toBe('poison');
      expect(byId['poison-json']!.error).toContain('not valid JSON');
      expect(byId['poison-schema']!.error).toContain('order_id missing');
      expect(byId[event.event_id]!.headers[MESSAGE_HEADERS.errorKind]).toBe('retryable');
      expect((await admin.list()).find((q) => q.queue === 'q.notifications.dlq')!.messages).toBe(3);
      healthy = true;
      const result = await admin.replay('q.notifications.dlq', [event.event_id]);
      expect(result).toEqual({ replayed: 1, remaining: 2 });
      await waitFor(() => handled.includes(event.event_id));
    } finally {
      await consumer.stop();
      await channel.purgeQueue('q.notifications.dlq');
    }
  }, 40000);

  it('dedupes redelivered messages with Redis', async () => {
    await channel.purgeQueue('q.notifications');
    const redis = new Redis(inject('redisUrl'));
    const handled: string[] = [];
    const consumer = new Consumer(client, publisher, {
      queue: 'notifications',
      consumer: 'test-dedupe',
      prefetch: 10,
      handler: async (_m, ctx) => {
        handled.push(ctx.messageId);
      },
      idempotency: { deduper: new RedisDeduper(redis, { prefix: inject('redisPrefix'), ttlSeconds: 60 }) },
    });
    consumer.start();
    const event = domainEvent('order.fulfilled');
    for (let i = 0; i < 3; i++)
      await publisher.publish({
        exchange: 'domain',
        routingKey: 'order.fulfilled',
        body: event,
        messageId: event.event_id,
      });
    await new Promise((r) => setTimeout(r, 1500));
    await consumer.stop();
    expect(handled).toEqual([event.event_id]);
    await redis.del(`${inject('redisPrefix')}dedup:test-dedupe:${event.event_id}`);
    redis.disconnect();
  });

  it('batch consumer acks after the batch handler and retries the whole batch on failure', async () => {
    await channel.purgeQueue('q.reco.cooccurrence');
    let fail = true;
    const batches: number[] = [];
    const consumer = new BatchConsumer(client, publisher, {
      queue: 'reco.cooccurrence',
      consumer: 'test-batch',
      prefetch: 50,
      batchSize: 10,
      flushIntervalMs: 200,
      parse: (value) => value,
      retry: { delays: ['5s'] },
      handleBatch: async (items) => {
        if (fail) {
          fail = false;
          throw new Error('insert failed');
        }
        batches.push(items.length);
      },
    });
    consumer.start();
    for (let i = 0; i < 25; i++) {
      const event = domainEvent('order.placed');
      await publisher.publish({
        exchange: 'domain',
        routingKey: 'order.placed',
        body: event,
        messageId: event.event_id,
      });
    }
    await waitFor(() => batches.reduce((a, b) => a + b, 0) === 25, 30000);
    await consumer.stop();
    const info = await channel.checkQueue('q.reco.cooccurrence');
    expect(info.messageCount).toBe(0);
    expect(Math.max(...batches)).toBeLessThanOrEqual(10);
  }, 40000);

  it('graceful shutdown waits for in-flight handlers', async () => {
    await channel.purgeQueue('q.notifications');
    let finished = false;
    const consumer = new Consumer(client, publisher, {
      queue: 'notifications',
      consumer: 'test-shutdown',
      prefetch: 1,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 800));
        finished = true;
      },
    });
    consumer.start();
    const event = domainEvent('order.fulfilled');
    await publisher.publish({
      exchange: 'domain',
      routingKey: 'order.fulfilled',
      body: event,
      messageId: event.event_id,
    });
    await new Promise((r) => setTimeout(r, 200));
    await consumer.stop();
    expect(finished).toBe(true);
    const info = await channel.checkQueue('q.notifications');
    expect(info.messageCount).toBe(0);
  });
});
