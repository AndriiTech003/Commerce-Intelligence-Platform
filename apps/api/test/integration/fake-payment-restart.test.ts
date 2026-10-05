import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import {
  createProduct,
  http,
  resources,
  Shopper,
  signupMerchant,
  startApi,
  waitFor,
  type Merchant,
} from './support/harness';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DELAY_MS = 2000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

interface ApiProcess {
  child: ChildProcess;
  output: string[];
}

function spawnApi(port: number): ApiProcess {
  const r = resources();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      API_PORT: String(port),
      API_HOST: '127.0.0.1',
      INTERNAL_API_URL: `http://127.0.0.1:${port}`,
      DATABASE_URL: r.databaseUrl,
      DATABASE_SYSTEM_URL: r.databaseSystemUrl,
      DATABASE_ADMIN_URL: r.databaseAdminUrl,
      REDIS_URL: r.redisUrl,
      REDIS_PREFIX: r.redisPrefix,
      RABBITMQ_URL: r.rabbitUrl,
      CLICKHOUSE_URL: r.clickhouseUrl,
      CLICKHOUSE_DATABASE: r.clickhouseDatabase,
      S3_ENDPOINT: r.s3Endpoint,
      S3_PUBLIC_URL: r.s3Endpoint,
      S3_KEY_PREFIX: r.s3KeyPrefix,
      SMTP_PORT: String(r.smtpPort),
      FAKE_PAYMENT_DELAY_MS: String(DELAY_MS),
      FAKE_PAYMENT_POLL_MS: '250',
      STOREFRONT_RATE_LIMIT_PER_MIN: '100000',
      CONSUMERS_ENABLED: 'false',
      JOBS_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  return { child, output };
}

async function waitReady(base: string, proc: ApiProcess): Promise<void> {
  await waitFor(
    async () => {
      if (proc.child.exitCode !== null) throw new Error(`api exited: ${proc.output.join('')}`);
      const res = await fetch(`${base}/health/ready`).catch(() => null);
      return res?.status === 200;
    },
    60000,
    100,
  );
}

async function stop(proc: ApiProcess | null, signal: NodeJS.Signals): Promise<void> {
  if (!proc || proc.child.exitCode !== null || proc.child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => proc.child.once('exit', () => resolve()));
  proc.child.kill(signal);
  const timer = setTimeout(() => proc.child.kill('SIGKILL'), 10000);
  await exited;
  clearTimeout(timer);
}

describe('fake payment webhook survives an API restart', () => {
  let port: number;
  let base: string;
  let first: ApiProcess | null = null;
  let second: ApiProcess | null = null;
  let merchant: Merchant;
  let admin: pg.Client;

  beforeAll(async () => {
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    first = spawnApi(port);
    await waitReady(base, first);
    merchant = await signupMerchant(base, 'restart');
    admin = new pg.Client({ connectionString: resources().databaseAdminUrl });
    await admin.connect();
  });

  afterAll(async () => {
    await stop(first, 'SIGKILL');
    await stop(second, 'SIGTERM');
    await admin?.end();
  });

  it('delivers the pending webhook after the API is killed inside the delay window', async () => {
    const product = await createProduct(base, merchant, { variants: [{ onHand: 5, priceCents: 4200 }] });
    const shopper = new Shopper(base, merchant.slug);
    expect((await shopper.addItem(product.variants[0]!.id)).status).toBe(200);
    const order = await shopper.checkout(`restart-${uuidv7()}`);
    expect(order.status).toBe(201);
    const intentId = order.body.payment.intentId as string;

    const confirmedAt = Date.now();
    const confirm = await shopper.request('POST', `/v1/payments/fake/${intentId}/confirm`, {
      cardNumber: '4242 4242 4242 4242',
    });
    expect(confirm.status).toBe(202);
    await stop(first, 'SIGKILL');
    const killedAfterMs = Date.now() - confirmedAt;
    expect(killedAfterMs).toBeLessThan(DELAY_MS);

    const pending = await admin.query<{ status: string; attempts: number }>(
      'select status, attempts from fake_payment_webhooks where intent_id = $1',
      [intentId],
    );
    expect(pending.rows).toEqual([{ status: 'pending', attempts: 0 }]);
    const before = await admin.query<{ status: string }>('select status from orders where id = $1', [
      order.body.orderId,
    ]);
    expect(before.rows[0]!.status).toBe('pending_payment');

    second = spawnApi(port);
    await waitReady(base, second);
    const restartedAfterMs = Date.now() - confirmedAt;

    await waitFor(
      async () =>
        (
          await http(base, 'GET', `/v1/storefront/orders/${order.body.orderId}`, {
            headers: shopper.headers(),
          })
        ).body?.status === 'paid',
      30000,
      100,
    );
    const paidAfterMs = Date.now() - confirmedAt;

    const delivered = await admin.query<{ status: string; attempts: number; delivered_at: Date | null }>(
      'select status, attempts, delivered_at from fake_payment_webhooks where intent_id = $1',
      [intentId],
    );
    expect(delivered.rows).toHaveLength(1);
    expect(delivered.rows[0]!.status).toBe('delivered');
    expect(delivered.rows[0]!.delivered_at).not.toBeNull();
    const payment = await admin.query<{ status: string }>(
      'select status from payments where provider_ref = $1',
      [intentId],
    );
    expect(payment.rows[0]!.status).toBe('succeeded');
    const history = await admin.query<{ n: number }>(
      "select count(*)::int as n from order_status_history where order_id = $1 and to_status = 'paid'",
      [order.body.orderId],
    );
    expect(history.rows[0]!.n).toBe(1);
    process.stdout.write(
      `fake webhook restart: killed after ${killedAfterMs} ms, api back after ${restartedAfterMs} ms, order paid after ${paidAfterMs} ms (delay ${DELAY_MS} ms)\n`,
    );
  });

  it('delivers a webhook that became due while the API was down exactly once after startup', async () => {
    const product = await createProduct(base, merchant, { variants: [{ onHand: 5, priceCents: 1500 }] });
    const shopper = new Shopper(base, merchant.slug);
    await shopper.addItem(product.variants[0]!.id);
    const order = await shopper.checkout(`restart-retry-${uuidv7()}`);
    const intentId = order.body.payment.intentId as string;
    const confirm = await shopper.request('POST', `/v1/payments/fake/${intentId}/confirm`, {
      cardNumber: '4242 4242 4242 4242',
    });
    expect(confirm.status).toBe(202);
    await stop(second, 'SIGKILL');
    await admin.query(`update fake_payment_webhooks set due_at = now() where intent_id = $1`, [intentId]);
    second = spawnApi(port);
    await waitReady(base, second);
    await waitFor(
      async () =>
        (
          await http(base, 'GET', `/v1/storefront/orders/${order.body.orderId}`, {
            headers: shopper.headers(),
          })
        ).body?.status === 'paid',
      30000,
      100,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rows = await admin.query<{ status: string }>(
      'select status from fake_payment_webhooks where intent_id = $1',
      [intentId],
    );
    expect(rows.rows).toEqual([{ status: 'delivered' }]);
    const history = await admin.query<{ n: number }>(
      "select count(*)::int as n from order_status_history where order_id = $1 and to_status = 'paid'",
      [order.body.orderId],
    );
    expect(history.rows[0]!.n).toBe(1);
  });

  it('retries with backoff while the webhook endpoint is unreachable', async () => {
    await stop(second, 'SIGTERM');
    const unreachable = await freePort();
    const local = await startApi({
      FAKE_PAYMENT_DELAY_MS: '0',
      FAKE_PAYMENT_POLL_MS: '200',
      JOBS_ENABLED: 'false',
    });
    try {
      local.config.INTERNAL_API_URL = `http://127.0.0.1:${unreachable}`;
      const product = await createProduct(local.url, merchant, { variants: [{ onHand: 5 }] });
      const shopper = new Shopper(local.url, merchant.slug);
      await shopper.addItem(product.variants[0]!.id);
      const order = await shopper.checkout(`retry-${uuidv7()}`);
      const intentId = order.body.payment.intentId as string;
      await shopper.request('POST', `/v1/payments/fake/${intentId}/confirm`, {
        cardNumber: '4242 4242 4242 4242',
      });
      const failing = await waitFor(async () => {
        const { rows } = await admin.query<{ attempts: number; last_error: string | null; status: string }>(
          'select attempts, last_error, status from fake_payment_webhooks where intent_id = $1',
          [intentId],
        );
        return rows[0] && rows[0].attempts >= 2 ? rows[0] : null;
      }, 15000);
      expect(failing.status).toBe('pending');
      expect(failing.last_error).toBeTruthy();
      local.config.INTERNAL_API_URL = local.url;
      await waitFor(
        async () =>
          (await shopper.request('GET', `/v1/storefront/orders/${order.body.orderId}`)).body.status ===
          'paid',
        20000,
      );
      const { rows } = await admin.query<{ status: string; attempts: number }>(
        'select status, attempts from fake_payment_webhooks where intent_id = $1',
        [intentId],
      );
      expect(rows[0]!.status).toBe('delivered');
      expect(rows[0]!.attempts).toBeGreaterThanOrEqual(3);
    } finally {
      await local.close();
    }
  });
});
