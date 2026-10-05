import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { AmqpClient, Publisher } from '@cip/messaging';
import { loadConfig as loadDomainConfig } from '../../../domain-worker/src/config';
import { startDomainWorker, type DomainWorker } from '../../../domain-worker/src/worker';
import { loadConfig as loadStreamConfig } from '../../../stream-worker/src/config';
import { startStreamWorker, type StreamWorker } from '../../../stream-worker/src/worker';
import {
  createProduct,
  http,
  mailpitMessages,
  resources,
  Shopper,
  signupMerchant,
  startApi,
  waitFor,
  type Merchant,
  type TestApi,
} from './support/harness';

describe('order pipeline: outbox → RabbitMQ → notifications, ClickHouse and realtime', () => {
  let app: TestApi;
  let merchant: Merchant;
  let domain: DomainWorker;
  let stream: StreamWorker;
  let admin: pg.Client;

  beforeAll(async () => {
    const r = resources();
    app = await startApi({ FAKE_PAYMENT_DELAY_MS: '50', CONSUMERS_ENABLED: 'true' });
    merchant = await signupMerchant(app.url, 'pipe');
    const common = {
      LOG_LEVEL: 'silent',
      REDIS_URL: r.redisUrl,
      REDIS_PREFIX: r.redisPrefix,
      RABBITMQ_URL: r.rabbitUrl,
    };
    domain = await startDomainWorker(
      loadDomainConfig({
        ...common,
        DATABASE_SYSTEM_URL: r.databaseSystemUrl,
        SMTP_PORT: String(r.smtpPort),
        RESERVATION_EXPIRY_INTERVAL_MS: '600000',
      }),
      { opsServer: false },
    );
    stream = await startStreamWorker(
      loadStreamConfig({
        ...common,
        CLICKHOUSE_URL: r.clickhouseUrl,
        CLICKHOUSE_DATABASE: r.clickhouseDatabase,
        FLUSH_INTERVAL_MS: '200',
        TICK_INTERVAL_MS: '500',
      }),
      { opsServer: false },
    );
    admin = new pg.Client({ connectionString: r.databaseAdminUrl });
    await admin.connect();
    await waitFor(async () => domain.amqp.connected && stream.amqp.connected);
  });

  afterAll(async () => {
    await admin.end();
    await stream.stop();
    await domain.stop();
    await app.close();
  });

  it('a paid order sends one email, lands in ClickHouse and shows up in analytics', async () => {
    const product = await createProduct(app.url, merchant, {
      title: 'Pipeline Shoe',
      variants: [{ onHand: 5, priceCents: 4200 }],
    });
    const shopper = new Shopper(app.url, merchant.slug);
    await shopper.addItem(product.variants[0]!.id);
    const email = `pipe-${Date.now()}@buyer.dev`;
    const order = await shopper.checkout(`pipe-${uuidv7()}`, { email });
    expect(order.status).toBe(201);
    await shopper.request('POST', `/v1/payments/fake/${order.body.payment.intentId}/confirm`, {
      cardNumber: '4242424242424242',
    });
    const messages = await waitFor(async () => {
      const found = await mailpitMessages(email);
      return found.length > 0 ? found : null;
    }, 20000);
    expect(messages[0]!.Subject).toContain(`payment received for order #${order.body.number}`);
    const paidEvent = await admin.query(
      "select id, payload, tenant_id, created_at from outbox where aggregate_id = $1 and event_type = 'order.paid'",
      [order.body.orderId],
    );
    const row = paidEvent.rows[0];
    const amqp = new AmqpClient({ url: resources().rabbitUrl, name: 'pipe-test' });
    const publisher = new Publisher(amqp);
    await amqp.start({ waitForConnection: true });
    await waitFor(async () => publisher.ready);
    await publisher.publish({
      exchange: 'domain',
      routingKey: 'order.paid',
      messageId: row.id,
      body: {
        event_id: row.id,
        event_type: 'order.paid',
        schema_version: 1,
        tenant_id: row.tenant_id,
        occurred_at: new Date(row.created_at).toISOString(),
        properties: row.payload,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await amqp.close();
    expect(await mailpitMessages(email)).toHaveLength(1);
    const processed = await admin.query(
      "select count(*)::int as n from processed_messages where consumer = 'notifications' and message_id = $1",
      [row.id],
    );
    expect(processed.rows[0].n).toBe(1);
    const overview = await waitFor(async () => {
      const res = await http(app.url, 'GET', '/v1/admin/analytics/overview', { headers: merchant.headers });
      return res.body.revenueCents?.value === order.body.totalCents ? res.body : null;
    }, 20000);
    expect(overview.orders.value).toBe(1);
    const top = await http(app.url, 'GET', '/v1/admin/analytics/top-products?by=revenue', {
      headers: merchant.headers,
    });
    expect(top.body.items[0]).toMatchObject({ productId: product.id, title: 'Pipeline Shoe', purchases: 1 });
    const live = await http(app.url, 'GET', '/v1/admin/analytics/live', { headers: merchant.headers });
    expect(live.body.revenueTodayCents).toBe(order.body.totalCents);
    expect(live.body.ordersToday).toBe(1);
    const ticket = await http(app.url, 'POST', '/v1/admin/realtime/ticket', { headers: merchant.headers });
    expect(ticket.status).toBe(201);
    expect(ticket.body.ticket.length).toBeGreaterThan(20);
  }, 60000);

  it('platform admins can list, peek and replay DLQ messages through the API', async () => {
    await admin.query('update users set is_platform_admin = true where id = $1', [merchant.userId]);
    const login = await http(app.url, 'POST', '/v1/auth/login', {
      body: { email: merchant.email, password: 'password123' },
    });
    const headers = { authorization: `Bearer ${login.body.accessToken}` };
    const amqp = new AmqpClient({ url: resources().rabbitUrl, name: 'dlq-test' });
    const publisher = new Publisher(amqp);
    await amqp.start({ waitForConnection: true });
    await waitFor(async () => publisher.ready);
    await publisher.publish({
      exchange: 'track',
      routingKey: 'page_viewed',
      body: { broken: true },
      messageId: `poison-${uuidv7()}`,
    });
    await amqp.close();
    const list = await waitFor(async () => {
      const res = await http(app.url, 'GET', '/v1/platform/dlq', { headers });
      const queue = res.body.data?.find((q: { queue: string }) => q.queue === 'q.analytics.ingest.dlq');
      return queue && queue.messages >= 1 ? res.body : null;
    }, 20000);
    expect(list.data.map((q: { queue: string }) => q.queue)).toContain('q.notifications.dlq');
    const peek = await http(app.url, 'GET', '/v1/platform/dlq/q.analytics.ingest.dlq/messages?limit=5', {
      headers,
    });
    expect(peek.body.data[0].error).toContain('Poison');
    const replay = await http(app.url, 'POST', '/v1/platform/dlq/q.analytics.ingest.dlq/replay', {
      headers,
      body: { messageIds: 'all' },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBeGreaterThanOrEqual(1);
    expect((await http(app.url, 'GET', '/v1/platform/dlq/q.unknown.dlq/messages', { headers })).status).toBe(
      404,
    );
  }, 60000);
});
