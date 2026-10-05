import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { loadConfig as loadDomainConfig } from '../../../domain-worker/src/config';
import { verifySignature } from '../../../domain-worker/src/webhooks';
import { startDomainWorker, type DomainWorker } from '../../../domain-worker/src/worker';
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

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

function receiver(status: () => number) {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = status();
      res.end('ok');
    });
  });
  return {
    received,
    start: () =>
      new Promise<string>((resolve) =>
        server.listen(0, '127.0.0.1', () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`),
        ),
      ),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('operations: merchant webhooks, CSV import, AI insights', () => {
  let app: TestApi;
  let m: Merchant;
  let domain: DomainWorker;

  beforeAll(async () => {
    const r = resources();
    app = await startApi({ FAKE_PAYMENT_DELAY_MS: '50' });
    m = await signupMerchant(app.url, 'ops');
    domain = await startDomainWorker(
      loadDomainConfig({
        LOG_LEVEL: 'silent',
        DATABASE_SYSTEM_URL: r.databaseSystemUrl,
        REDIS_URL: r.redisUrl,
        REDIS_PREFIX: r.redisPrefix,
        RABBITMQ_URL: r.rabbitUrl,
        SMTP_PORT: String(r.smtpPort),
        RESERVATION_EXPIRY_INTERVAL_MS: '600000',
        WEBHOOK_RETRY_SCHEDULE: '1,1',
        WEBHOOK_POLL_INTERVAL_MS: '300',
        WEBHOOK_TIMEOUT_MS: '2000',
      }),
      { opsServer: false },
    );
  });

  afterAll(async () => {
    await domain.stop();
    await app.close();
  });

  async function paidOrder() {
    const product = await createProduct(app.url, m, { variants: [{ onHand: 5, priceCents: 2500 }] });
    const shopper = new Shopper(app.url, m.slug);
    await shopper.addItem(product.variants[0]!.id);
    const order = await shopper.checkout(`wh-${uuidv7()}`);
    expect(order.status).toBe(201);
    await shopper.request('POST', `/v1/payments/fake/${order.body.payment.intentId}/confirm`, {
      cardNumber: '4242424242424242',
    });
    return order.body as { orderId: string };
  }

  it('delivers order.paid with an HMAC signature exactly once per endpoint', async () => {
    const hook = receiver(() => 200);
    const url = await hook.start();
    try {
      const created = await http(app.url, 'POST', '/v1/admin/webhooks', {
        headers: m.headers,
        body: { url, events: ['order.paid'] },
      });
      expect(created.status).toBe(201);
      expect(created.body.secret).toMatch(/^whsec_/);
      const order = await paidOrder();
      const delivery = await waitFor(
        async () => hook.received.find((r) => r.body.includes(order.orderId)),
        20000,
      );
      const signature = String(delivery.headers['x-signature']);
      expect(verifySignature(created.body.secret, signature, delivery.body)).toBe(true);
      expect(verifySignature('whsec_wrong', signature, delivery.body)).toBe(false);
      expect(JSON.parse(delivery.body)).toMatchObject({
        type: 'order.paid',
        data: { order_id: order.orderId },
      });
      const log = await waitFor(async () => {
        const res = await http(app.url, 'GET', `/v1/admin/webhooks/${created.body.id}/deliveries`, {
          headers: m.headers,
        });
        return res.body.data.find((d: { status: string }) => d.status === 'succeeded');
      });
      expect(log).toMatchObject({ attempts: 1, lastStatusCode: 200, eventType: 'order.paid' });
      await new Promise((r) => setTimeout(r, 1000));
      expect(hook.received.filter((r) => r.body.includes(order.orderId))).toHaveLength(1);
      const other = await signupMerchant(app.url, 'ops2');
      const foreign = await http(app.url, 'GET', `/v1/admin/webhooks/${created.body.id}/deliveries`, {
        headers: other.headers,
      });
      expect(foreign.status).toBe(404);
      await http(app.url, 'DELETE', `/v1/admin/webhooks/${created.body.id}`, { headers: m.headers });
    } finally {
      await hook.stop();
    }
  });

  it('retries with backoff, disables the endpoint after the last attempt, notifies the owner and can resend', async () => {
    let status = 500;
    const hook = receiver(() => status);
    const url = await hook.start();
    try {
      const created = await http(app.url, 'POST', '/v1/admin/webhooks', {
        headers: m.headers,
        body: { url, events: ['order.paid'] },
      });
      const order = await paidOrder();
      const dead = await waitFor(async () => {
        const res = await http(app.url, 'GET', `/v1/admin/webhooks/${created.body.id}/deliveries`, {
          headers: m.headers,
        });
        return res.body.data.find(
          (d: { status: string; payload: { data?: { order_id?: string } } }) =>
            d.status === 'dead' && d.payload.data?.order_id === order.orderId,
        );
      }, 30000);
      expect(dead.attempts).toBe(3);
      expect(hook.received.filter((r) => r.body.includes(order.orderId))).toHaveLength(3);
      const endpoints = await http(app.url, 'GET', '/v1/admin/webhooks', { headers: m.headers });
      expect(endpoints.body.data.find((e: { id: string }) => e.id === created.body.id).status).toBe(
        'disabled',
      );
      const mail = await waitFor(
        async () =>
          (await mailpitMessages(m.email)).find((x) => x.Subject.includes('Webhook endpoint disabled')),
        15000,
      );
      expect(mail).toBeTruthy();
      status = 200;
      const resent = await http(app.url, 'POST', `/v1/admin/webhooks/deliveries/${dead.id}/resend`, {
        headers: m.headers,
      });
      expect(resent.status).toBe(202);
      const ok = await waitFor(async () => {
        const res = await http(app.url, 'GET', `/v1/admin/webhooks/${created.body.id}/deliveries`, {
          headers: m.headers,
        });
        return res.body.data.find(
          (d: { id: string; status: string }) => d.id === dead.id && d.status === 'succeeded',
        );
      }, 20000);
      expect(ok.attempts).toBe(1);
      const after = await http(app.url, 'GET', '/v1/admin/webhooks', { headers: m.headers });
      expect(after.body.data.find((e: { id: string }) => e.id === created.body.id).status).toBe('active');
    } finally {
      await hook.stop();
    }
  });

  it('imports products from CSV as a background job with a per-row error report', async () => {
    await http(app.url, 'POST', '/v1/admin/categories', {
      headers: m.headers,
      body: { name: 'Trail shoes', slug: 'trail-shoes' },
    });
    const sku = uuidv7().slice(-8).toUpperCase();
    const csv = [
      'handle,title,description,brand,status,category,tags,sku,variant_title,price,compare_at_price,stock',
      `trail-x,Import Trail X,"Grippy, light",Mountain Co,active,trail-shoes,running;trail,IMP-${sku}-41,41,129.00,149.00,5`,
      `trail-x,Import Trail X,,,active,trail-shoes,,IMP-${sku}-42,42,129.00,,3`,
      `bad-price,Bad price,,,active,,,IMP-${sku}-B,One,abc,,1`,
      `no-cat,No category,,,active,unknown-cat,,IMP-${sku}-C,One,10.00,,1`,
      `tee,Import Tee,,Velocity,draft,,,IMP-${sku}-T,M,25,,10`,
    ].join('\n');
    const res = await fetch(`${app.url}/v1/admin/products/import`, {
      method: 'POST',
      headers: { ...m.headers, 'content-type': 'text/csv' },
      body: csv,
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitFor(async () => {
      const r = await http(app.url, 'GET', `/v1/admin/jobs/${jobId}`, { headers: m.headers });
      return r.body.status === 'completed' ? r.body : null;
    }, 20000);
    expect(job).toMatchObject({
      type: 'product_import',
      total: 5,
      processed: 5,
      failed: 2,
      result: { productsCreated: 2 },
    });
    expect(job.errors.map((e: { row: number }) => e.row)).toEqual([4, 5]);
    expect(job.errors[1].message).toContain('unknown category');
    const list = await http(app.url, 'GET', '/v1/admin/products?q=Import%20Trail', { headers: m.headers });
    const imported = list.body.data.find((p: { title: string }) => p.title === 'Import Trail X');
    const detail = await http(app.url, 'GET', `/v1/admin/products/${imported.id}`, { headers: m.headers });
    expect(detail.body.variants).toHaveLength(2);
    expect(detail.body.variants[0].compareAtCents).toBe(14900);
    const again = await fetch(`${app.url}/v1/admin/products/import`, {
      method: 'POST',
      headers: { ...m.headers, 'content-type': 'text/csv' },
      body: csv,
    });
    const jobId2 = ((await again.json()) as { jobId: string }).jobId;
    const job2 = await waitFor(async () => {
      const r = await http(app.url, 'GET', `/v1/admin/jobs/${jobId2}`, { headers: m.headers });
      return r.body.status === 'completed' ? r.body : null;
    }, 20000);
    expect(
      job2.errors.filter((e: { message: string }) => e.message.includes('SKU already exists')),
    ).toHaveLength(3);
  });

  it('AI insights send only aggregates and keep observations grounded in the numbers', async () => {
    const res = await http(app.url, 'GET', '/v1/admin/analytics/insights', { headers: m.headers });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('fake:fake-template-v1');
    expect(res.body.observations.length).toBeGreaterThan(0);
    for (const observation of res.body.observations)
      for (const basis of observation.basis)
        if (!basis.metric.startsWith('funnel.')) {
          const value = basis.metric
            .split('.')
            .reduce(
              (o: Record<string, unknown> | undefined, k: string) =>
                o?.[k] as Record<string, unknown> | undefined,
              res.body.aggregates,
            );
          expect(value).toEqual(basis.value);
        }
    expect(JSON.stringify(res.body.aggregates)).not.toContain('@');
    const cached = await http(app.url, 'GET', '/v1/admin/analytics/insights', { headers: m.headers });
    expect(cached.body.cached).toBe(true);
  });
});
