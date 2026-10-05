import { connect } from 'amqplib';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { redisKeys, uuidv7 } from '@cip/contracts';
import { startTelemetry } from '@cip/observability';
import { loadConfig, startCollector, type RunningCollector } from '../../src';
import { hashKey } from '../../src/keys';

describe('collector against Redis and RabbitMQ', () => {
  const env = inject('env');
  const key = `pk_live_${'A'.repeat(32)}`;
  const tenantId = uuidv7();
  let collector: RunningCollector;
  let redis: Redis;

  beforeAll(async () => {
    startTelemetry({ serviceName: 'collector-test' });
    redis = new Redis(env.REDIS_URL!);
    const redisKey = redisKeys(env.REDIS_PREFIX).apiKey(hashKey(key));
    await redis.hset(redisKey, {
      id: uuidv7(),
      tenantId,
      kind: 'publishable',
      prefix: key.slice(0, 12),
      scopes: '',
      createdAt: '0',
    });
    await redis.expire(redisKey, 300);
    collector = await startCollector(loadConfig(env));
    await collector.amqp.waitForConnection();
  });

  afterAll(async () => {
    await collector.stop();
    const found = await redis.keys(`${env.REDIS_PREFIX}*`);
    if (found.length) await redis.del(...found);
    redis.disconnect();
  });

  const event = () => ({
    event_id: uuidv7(),
    event_type: 'page_viewed',
    occurred_at: new Date().toISOString(),
    anonymous_id: uuidv7(),
    properties: { page_type: 'home' },
  });

  it('publishes accepted events to the track exchange with confirms', async () => {
    const events = [event(), event(), event()];
    const res = await fetch(`${collector.url}/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
      body: JSON.stringify({ events }),
    });
    expect(res.status).toBe(202);
    const model = await connect(env.RABBITMQ_URL!);
    const channel = await model.createChannel();
    const received: Array<{ id: string; tenant: string; trace: string }> = [];
    for (let i = 0; i < 20 && received.length < 3; i++) {
      const message = await channel.get('q.analytics.ingest', { noAck: true });
      if (message) {
        const body = JSON.parse(message.content.toString()) as { event_id: string; tenant_id: string };
        received.push({
          id: body.event_id,
          tenant: body.tenant_id,
          trace: String(message.properties.headers?.traceparent ?? ''),
        });
      } else await new Promise((r) => setTimeout(r, 100));
    }
    await model.close();
    expect(received.map((r) => r.id).sort()).toEqual(events.map((e) => e.event_id).sort());
    expect(received.every((r) => r.tenant === tenantId)).toBe(true);
    expect(received[0]!.trace.split('-')[1]).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('applies the per-key sliding window rate limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${collector.url}/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ events: Array.from({ length: 40 }, event) }),
      });
      statuses.push(res.status);
      if (res.status === 429) expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(statuses).toContain(429);
  });

  it('reports readiness and metrics', async () => {
    expect((await fetch(`${collector.url}/health/ready`)).status).toBe(200);
    const metrics = await (await fetch(`${collector.url}/metrics`)).text();
    expect(metrics).toContain('collector_events_total');
  });
});
