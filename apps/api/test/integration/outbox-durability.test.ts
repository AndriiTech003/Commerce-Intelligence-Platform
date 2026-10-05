import { execSync } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { connect, type ChannelModel } from 'amqplib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { AmqpClient, OutboxRelay, Publisher } from '@cip/messaging';
import {
  createProduct,
  resources,
  Shopper,
  signupMerchant,
  startApi,
  waitFor,
  type Merchant,
  type TestApi,
} from './support/harness';

const STOP = process.env.RABBITMQ_STOP_CMD ?? 'brew services stop rabbitmq';
const START = process.env.RABBITMQ_START_CMD ?? 'brew services start rabbitmq';

function amqpPortOpen(): Promise<boolean> {
  const url = new URL(resources().rabbitUrl);
  return new Promise((resolve) => {
    const socket = netConnect(Number(url.port || 5672), url.hostname);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function managementReady(): Promise<boolean> {
  try {
    const r = resources();
    const response = await fetch(`${r.rabbitManagementUrl}/api/vhosts/${encodeURIComponent(r.rabbitVhost)}`, {
      headers: { authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe('outbox durability: no domain event is lost while RabbitMQ is down', () => {
  let app: TestApi;
  let merchant: Merchant;
  let admin: pg.Client;
  const probe = `q.test.outbox.${Date.now()}`;

  beforeAll(async () => {
    app = await startApi();
    merchant = await signupMerchant(app.url, 'outbox');
    admin = new pg.Client({ connectionString: resources().databaseAdminUrl });
    await admin.connect();
    const model = await connect(resources().rabbitUrl);
    const channel = await model.createChannel();
    await channel.assertQueue(probe, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await channel.bindQueue(probe, 'domain', 'order.placed');
    await model.close();
  });

  afterAll(async () => {
    if (!(await amqpPortOpen())) execSync(START, { stdio: 'ignore' });
    await waitFor(managementReady, 60000, 500);
    const model = await connect(resources().rabbitUrl).catch(() => null);
    if (model) {
      const channel = await model.createChannel();
      await channel.deleteQueue(probe).catch(() => undefined);
      await model.close();
    }
    await admin.end();
    await app.close();
  });

  it('places 20 orders with the broker stopped and delivers all of them exactly once after restart', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 100 }] });
    execSync(STOP, { stdio: 'ignore' });
    await waitFor(async () => !(await amqpPortOpen()), 30000, 250);

    const orderIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const shopper = new Shopper(app.url, merchant.slug);
      await shopper.addItem(product.variants[0]!.id);
      const res = await shopper.checkout(`outbox-${uuidv7()}`);
      expect(res.status).toBe(201);
      orderIds.push(res.body.orderId);
    }
    const pending = await admin.query(
      "select count(*)::int as n from outbox where event_type = 'order.placed' and published_at is null and aggregate_id = any($1::uuid[])",
      [orderIds],
    );
    expect(pending.rows[0].n).toBe(20);

    const pool = new pg.Pool({ connectionString: resources().databaseSystemUrl, max: 3 });
    const amqp = new AmqpClient({
      url: resources().rabbitUrl,
      name: 'test-relay',
      reconnectDelayMs: 200,
      maxReconnectDelayMs: 1000,
    });
    const relay = new OutboxRelay({ pool, publisher: new Publisher(amqp), maxBackoffMs: 500 });
    await amqp.start();
    await relay.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const stillPending = await admin.query(
        'select count(*)::int as n, max(attempts) as attempts from outbox where published_at is null and aggregate_id = any($1::uuid[])',
        [orderIds],
      );
      expect(stillPending.rows[0].n).toBe(20);

      execSync(START, { stdio: 'ignore' });
      await waitFor(amqpPortOpen, 60000, 500);
      await waitFor(
        async () => {
          const { rows } = await admin.query(
            'select count(*)::int as n from outbox where published_at is null and aggregate_id = any($1::uuid[])',
            [orderIds],
          );
          return rows[0].n === 0;
        },
        60000,
        250,
      );
    } finally {
      await relay.stop();
      await amqp.close();
      await pool.end();
    }

    const model: ChannelModel = await connect(resources().rabbitUrl);
    const channel = await model.createChannel();
    const received: string[] = [];
    await waitFor(
      async () => {
        let message = await channel.get(probe, { noAck: false });
        while (message) {
          const body = JSON.parse(message.content.toString()) as { properties: { order_id: string } };
          received.push(body.properties.order_id);
          channel.ack(message);
          message = await channel.get(probe, { noAck: false });
        }
        return received.filter((id) => orderIds.includes(id)).length >= 20;
      },
      20000,
      250,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const late = await channel.get(probe, { noAck: true });
    await model.close();
    const ours = received.filter((id) => orderIds.includes(id));
    expect(ours).toHaveLength(20);
    expect(new Set(ours).size).toBe(20);
    expect(late).toBe(false);
  }, 240000);
});
