import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { createLogger } from '@cip/observability';
import { buildCollector } from '../../src/app';
import { PublishBuffer, type PublishPort } from '../../src/buffer';
import { countryFromIp, deviceFromUserAgent, enrich } from '../../src/enrich';

const tenantId = uuidv7();

function event(overrides: Record<string, unknown> = {}) {
  return {
    event_id: uuidv7(),
    event_type: 'product_viewed',
    occurred_at: new Date().toISOString(),
    anonymous_id: uuidv7(),
    properties: { product_id: uuidv7(), category_path: 'running', price_cents: 100 },
    ...overrides,
  };
}

function fakePublisher(ready = true) {
  const sent: unknown[] = [];
  const port: PublishPort & { ready: boolean } = {
    ready,
    publishMany: vi.fn(async (messages) => {
      sent.push(...messages);
      return messages.map(() =>
        port.ready ? { ok: true as const } : { ok: false as const, error: new Error('down') },
      );
    }),
  };
  return { port, sent };
}

async function app(options: { ready?: boolean; max?: number; allow?: boolean } = {}) {
  const { port, sent } = fakePublisher(options.ready ?? true);
  const buffer = new PublishBuffer(port, options.max ?? 100);
  const collector = await buildCollector({
    buffer,
    keys: {
      resolve: async (key) => (key === 'pk_live_valid0000000000000000' ? { id: 'key1', tenantId } : null),
    },
    limit: async () => ({ allowed: options.allow ?? true, limit: 10, remaining: 5, resetMs: 1500 }),
    ready: () => port.ready,
    logger: createLogger('test', { level: 'silent' }),
    maxEvents: 50,
    maxBodyBytes: 64 * 1024,
  });
  return { collector, sent, buffer, port };
}

const headers = { 'x-api-key': 'pk_live_valid0000000000000000', 'content-type': 'application/json' };

describe('enrichment', () => {
  it('detects devices and countries', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)')).toBe('mobile');
    expect(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)')).toBe('tablet');
    expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe('desktop');
    expect(countryFromIp('8.8.8.8')).toBe('US');
    expect(countryFromIp('127.0.0.1')).toBeUndefined();
  });

  it('sets tenant from the key, received_at, and fixes clock skew', () => {
    const received = new Date().toISOString();
    const enriched = enrich(
      { ...event({ occurred_at: '2020-01-01T00:00:00.000Z' }), schema_version: 1, properties: {} } as never,
      {
        tenantId,
        ip: '8.8.8.8',
        userAgent: 'Mozilla/5.0 (iPhone)',
        receivedAt: received,
      },
    );
    expect(enriched.tenant_id).toBe(tenantId);
    expect(enriched.occurred_at).toBe(received);
    expect((enriched.properties as Record<string, unknown>).clock_skew).toBe(true);
    expect((enriched.context as Record<string, unknown>).country).toBe('US');
  });
});

describe('collector HTTP', () => {
  it('accepts valid events and reports rejected ones by index', async () => {
    const { collector, sent } = await app();
    const res = await collector.inject({
      method: 'POST',
      url: '/v1/events',
      headers,
      payload: {
        events: [
          event(),
          event({ event_type: 'nope' }),
          event({ properties: {} }),
          { ...event(), tenant_id: uuidv7() },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.rejected.map((r: { index: number }) => r.index)).toEqual([1, 2]);
    expect((sent[1] as { body: { tenant_id: string } }).body.tenant_id).toBe(tenantId);
    await collector.close();
  });

  it('accepts sendBeacon text/plain bodies with the key in the query', async () => {
    const { collector } = await app();
    const res = await collector.inject({
      method: 'POST',
      url: '/v1/events?key=pk_live_valid0000000000000000',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ events: [event()] }),
    });
    expect(res.statusCode).toBe(202);
    await collector.close();
  });

  it('rejects unknown keys, oversized batches and rate limited clients', async () => {
    const { collector } = await app();
    expect(
      (
        await collector.inject({
          method: 'POST',
          url: '/v1/events',
          headers: { ...headers, 'x-api-key': 'pk_live_nope' },
          payload: { events: [event()] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await collector.inject({
          method: 'POST',
          url: '/v1/events',
          headers,
          payload: { events: Array.from({ length: 51 }, () => event()) },
        })
      ).statusCode,
    ).toBe(400);
    await collector.close();
    const limited = await app({ allow: false });
    const res = await limited.collector.inject({
      method: 'POST',
      url: '/v1/events',
      headers,
      payload: { events: [event()] },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('2');
    await limited.collector.close();
  });

  it('buffers while the broker is down and answers 503 with Retry-After when the buffer is full', async () => {
    const { collector, buffer, port } = await app({ ready: false, max: 3 });
    const first = await collector.inject({
      method: 'POST',
      url: '/v1/events',
      headers,
      payload: { events: [event(), event()] },
    });
    expect(first.statusCode).toBe(202);
    expect(buffer.length).toBe(2);
    const second = await collector.inject({
      method: 'POST',
      url: '/v1/events',
      headers,
      payload: { events: [event(), event()] },
    });
    expect(second.statusCode).toBe(503);
    expect(second.headers['retry-after']).toBe('5');
    port.ready = true;
    expect(await buffer.drain()).toBe(2);
    expect(buffer.length).toBe(0);
    await collector.close();
  });
});
