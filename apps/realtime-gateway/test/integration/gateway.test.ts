import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisKeys, uuidv7 } from '@cip/contracts';
import { loadConfig, startGateway, type RunningGateway } from '../../src';

const prefix = `tgw${randomBytes(3).toString('hex')}:`;
const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1';
const keys = redisKeys(prefix);

function open(url: string): Promise<{ ws: WebSocket; messages: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => messages.push(JSON.parse(String(data))));
    ws.once('open', () => resolve({ ws, messages }));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

async function waitFor(fn: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
}

describe('realtime gateway', () => {
  let gateway: RunningGateway;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(redisUrl);
    gateway = await startGateway(
      loadConfig({
        GATEWAY_PORT: '0',
        REDIS_URL: redisUrl,
        REDIS_PREFIX: prefix,
        LOG_LEVEL: 'silent',
        HEARTBEAT_MS: '200',
      }),
    );
  });

  afterAll(async () => {
    await gateway.stop();
    redis.disconnect();
  });

  async function ticket(tenantId: string) {
    const value = randomBytes(16).toString('hex');
    await redis.set(keys.wsTicket(value), JSON.stringify({ tenantId, userId: uuidv7() }), 'EX', 30);
    return value;
  }

  it('rejects connections without a valid ticket and tickets are single use', async () => {
    await expect(open(`${gateway.url}?ticket=bogus`)).rejects.toThrow('401');
    const tenant = uuidv7();
    const t = await ticket(tenant);
    const { ws } = await open(`${gateway.url}?ticket=${t}`);
    ws.close();
    await expect(open(`${gateway.url}?ticket=${t}`)).rejects.toThrow('401');
  });

  it('delivers ticks only to sockets of the same tenant and honours pause', async () => {
    const a = uuidv7();
    const b = uuidv7();
    const first = await open(`${gateway.url}?ticket=${await ticket(a)}`);
    const second = await open(`${gateway.url}?ticket=${await ticket(b)}`);
    await waitFor(() => first.messages.length > 0 && second.messages.length > 0);
    expect(first.messages[0]).toMatchObject({ type: 'hello', tenantId: a });
    await redis.publish(keys.tickChannel(a), JSON.stringify({ type: 'tick', tenantId: a, eventsPerSec: 3 }));
    await waitFor(() => first.messages.some((m) => m.type === 'tick'));
    expect(second.messages.some((m) => m.type === 'tick')).toBe(false);
    first.ws.send(JSON.stringify({ type: 'pause' }));
    await new Promise((r) => setTimeout(r, 100));
    const before = first.messages.length;
    await redis.publish(keys.eventsChannel(a), JSON.stringify({ type: 'event', item: {} }));
    await new Promise((r) => setTimeout(r, 200));
    expect(first.messages.length).toBe(before);
    first.ws.send(JSON.stringify({ type: 'ping' }));
    await waitFor(() => first.messages.some((m) => m.type === 'pong'));
    first.ws.close();
    second.ws.close();
  });

  it('keeps live connections with heartbeats and exposes metrics', async () => {
    const conn = await open(`${gateway.url}?ticket=${await ticket(uuidv7())}`);
    await new Promise((r) => setTimeout(r, 700));
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);
    expect(gateway.clients()).toBeGreaterThanOrEqual(1);
    const http = gateway.url.replace('ws://', 'http://').replace('/ws', '');
    expect(await (await fetch(`${http}/metrics`)).text()).toContain('ws_connections');
    conn.ws.close();
  });
});
