import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { expireReservations } from '../../../domain-worker/src/jobs/reservation-expiry';
import { FAKE_SIGNATURE_HEADER, signatureHeader } from '../../src/modules/payments';
import {
  createProduct,
  http,
  resources,
  Shopper,
  signupMerchant,
  startApi,
  waitFor,
  type Merchant,
  type TestApi,
} from './support/harness';

async function stock(admin: pg.Client, variantId: string) {
  const { rows } = await admin.query<{ on_hand: number; reserved: number }>(
    'select on_hand, reserved from inventory_items where variant_id = $1',
    [variantId],
  );
  return rows[0]!;
}

function webhook(
  app: TestApi,
  event: {
    id: string;
    type: string;
    intentId: string;
    tenantId: string;
    orderId: string;
    amountCents: number;
  },
  secret?: string,
) {
  const raw = JSON.stringify({
    id: event.id,
    type: event.type,
    data: {
      intentId: event.intentId,
      tenantId: event.tenantId,
      orderId: event.orderId,
      amountCents: event.amountCents,
    },
  });
  return http(app.url, 'POST', '/v1/payments/webhooks/fake', {
    raw,
    headers: {
      [FAKE_SIGNATURE_HEADER]: signatureHeader(secret ?? app.config.FAKE_PAYMENT_WEBHOOK_SECRET, raw),
    },
  });
}

describe('checkout invariants', () => {
  let app: TestApi;
  let merchant: Merchant;
  let admin: pg.Client;

  beforeAll(async () => {
    app = await startApi({ FAKE_PAYMENT_DELAY_MS: '600000' });
    merchant = await signupMerchant(app.url, 'co');
    admin = new pg.Client({ connectionString: resources().databaseAdminUrl });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  it('no overselling: 100 concurrent checkouts on stock 10 produce exactly 10 orders', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 10, priceCents: 2500 }] });
    const variantId = product.variants[0]!.id;
    const shoppers = Array.from({ length: 100 }, () => new Shopper(app.url, merchant.slug));
    for (const shopper of shoppers) {
      const r = await shopper.request('POST', '/v1/storefront/cart/items', { variantId, quantity: 1 });
      expect(r.status).toBe(200);
    }
    const results = await Promise.all(shoppers.map((s) => s.checkout(`oversell-${s.anonymousId}`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(90);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'INSUFFICIENT_STOCK')).toBe(
      true,
    );
    expect(results.find((r) => r.status === 409)!.body.errors[0]).toMatchObject({
      variantId,
      requested: 1,
      available: 0,
    });
    expect(await stock(admin, variantId)).toEqual({ on_hand: 10, reserved: 10 });
    const orders = await admin.query('select count(*)::int as n from order_items where variant_id = $1', [
      variantId,
    ]);
    expect(orders.rows[0].n).toBe(10);
    const numbers = results.filter((r) => r.status === 201).map((r) => r.body.number as number);
    expect(new Set(numbers).size).toBe(10);
  }, 120000);

  it('no deadlock when carts contain the same two items in reverse order', async () => {
    const a = await createProduct(app.url, merchant, { variants: [{ onHand: 30 }] });
    const b = await createProduct(app.url, merchant, { variants: [{ onHand: 30 }] });
    const va = a.variants[0]!.id;
    const vb = b.variants[0]!.id;
    const shoppers = Array.from({ length: 40 }, () => new Shopper(app.url, merchant.slug));
    for (const [index, shopper] of shoppers.entries()) {
      const order = index % 2 === 0 ? [va, vb] : [vb, va];
      for (const variantId of order) await shopper.addItem(variantId);
    }
    const results = await Promise.all(shoppers.map((s) => s.checkout(`deadlock-${s.anonymousId}`)));
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(30);
    expect(await stock(admin, va)).toEqual({ on_hand: 30, reserved: 30 });
    expect(await stock(admin, vb)).toEqual({ on_hand: 30, reserved: 30 });
  }, 120000);

  it('idempotency: 5 parallel requests with one key create one order; another body gets 422', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 50 }] });
    const shopper = new Shopper(app.url, merchant.slug);
    await shopper.addItem(product.variants[0]!.id, 2);
    const key = `idem-${uuidv7()}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => shopper.checkout(key)));
    const created = results.filter((r) => r.status === 201);
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(
      results.every(
        (r) => r.status === 201 || (r.status === 409 && r.body.code === 'IDEMPOTENCY_IN_PROGRESS'),
      ),
    ).toBe(true);
    expect(new Set(created.map((r) => r.body.orderId)).size).toBe(1);
    const replay = await shopper.checkout(key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body.orderId).toBe(created[0]!.body.orderId);
    const count = await admin.query('select count(*)::int as n from orders where idempotency_key = $1', [
      key,
    ]);
    expect(count.rows[0].n).toBe(1);
    const different = await shopper.checkout(key, { shippingMethod: 'express' });
    expect(different.status).toBe(422);
    expect(different.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const missing = await shopper.request('POST', '/v1/storefront/checkout', {});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('idempotency survives Redis losing the key (unique index fallback)', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 5 }] });
    const shopper = new Shopper(app.url, merchant.slug);
    await shopper.addItem(product.variants[0]!.id);
    const key = `redis-lost-${uuidv7()}`;
    const first = await shopper.checkout(key);
    expect(first.status).toBe(201);
    const redis = new (await import('ioredis')).Redis(resources().redisUrl);
    const keys = await redis.keys(`${resources().redisPrefix}idem:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
    const second = await shopper.checkout(key);
    expect(second.status).toBe(201);
    expect(second.body.orderId).toBe(first.body.orderId);
    const count = await admin.query('select count(*)::int as n from orders where idempotency_key = $1', [
      key,
    ]);
    expect(count.rows[0].n).toBe(1);
  });

  it('webhook: the same event three times moves the order to paid exactly once; bad signature is 400', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 5, priceCents: 1999 }] });
    const shopper = new Shopper(app.url, merchant.slug);
    await shopper.addItem(product.variants[0]!.id, 2);
    const order = await shopper.checkout(`wh-${uuidv7()}`);
    expect(order.status).toBe(201);
    const event = {
      id: `evt_${uuidv7()}`,
      type: 'payment.succeeded',
      intentId: order.body.payment.intentId,
      tenantId: merchant.tenantId,
      orderId: order.body.orderId,
      amountCents: order.body.totalCents,
    };
    const bad = await webhook(app, event, 'wrong-secret-123');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_SIGNATURE');
    const unsigned = await http(app.url, 'POST', '/v1/payments/webhooks/fake', { raw: '{}' });
    expect(unsigned.status).toBe(400);
    const results = await Promise.all([webhook(app, event), webhook(app, event), webhook(app, event)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    const status = await shopper.request('GET', `/v1/storefront/orders/${order.body.orderId}`);
    expect(status.body.status).toBe('paid');
    const history = await admin.query(
      "select count(*)::int as n from order_status_history where order_id = $1 and to_status = 'paid'",
      [order.body.orderId],
    );
    expect(history.rows[0].n).toBe(1);
    const outbox = await admin.query(
      "select count(*)::int as n from outbox where aggregate_id = $1 and event_type = 'order.paid'",
      [order.body.orderId],
    );
    expect(outbox.rows[0].n).toBe(1);
    expect(await stock(admin, product.variants[0]!.id)).toEqual({ on_hand: 3, reserved: 0 });
  });

  it('fake provider confirm drives the asynchronous webhook end to end', async () => {
    const fast = await startApi({ FAKE_PAYMENT_DELAY_MS: '50' });
    try {
      const product = await createProduct(fast.url, merchant, { variants: [{ onHand: 3 }] });
      const shopper = new Shopper(fast.url, merchant.slug);
      await shopper.addItem(product.variants[0]!.id);
      const order = await shopper.checkout(`fake-${uuidv7()}`);
      const confirm = await shopper.request(
        'POST',
        `/v1/payments/fake/${order.body.payment.intentId}/confirm`,
        { cardNumber: '4242 4242 4242 4242' },
      );
      expect(confirm.status).toBe(202);
      await waitFor(
        async () =>
          (await shopper.request('GET', `/v1/storefront/orders/${order.body.orderId}`)).body.status ===
          'paid',
      );
      const declined = new Shopper(fast.url, merchant.slug);
      await declined.addItem(product.variants[0]!.id);
      const failing = await declined.checkout(`fake-fail-${uuidv7()}`);
      await declined.request('POST', `/v1/payments/fake/${failing.body.payment.intentId}/confirm`, {
        cardNumber: '4000000000000002',
      });
      await waitFor(
        async () =>
          (await declined.request('GET', `/v1/storefront/orders/${failing.body.orderId}`)).body.status ===
          'payment_failed',
      );
      expect(await stock(admin, product.variants[0]!.id)).toEqual({ on_hand: 2, reserved: 0 });
    } finally {
      await fast.close();
    }
  });

  it('applies discounts with limits and recalculates prices', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 10, priceCents: 5000 }] });
    const code = `SAVE${Date.now() % 100000}`;
    const created = await http(app.url, 'POST', '/v1/admin/discounts', {
      headers: merchant.headers,
      body: { code, type: 'percent', value: 20, minSubtotalCents: 6000, usageLimit: 1 },
    });
    expect(created.status).toBe(201);
    const shopper = new Shopper(app.url, merchant.slug);
    await shopper.addItem(product.variants[0]!.id);
    const tooSmall = await shopper.request('POST', '/v1/storefront/cart/discount', { code });
    expect(tooSmall.status).toBe(422);
    expect(tooSmall.body.code).toBe('DISCOUNT_INVALID');
    await shopper.addItem(product.variants[0]!.id);
    const applied = await shopper.request('POST', '/v1/storefront/cart/discount', { code });
    expect(applied.status).toBe(200);
    expect(applied.body.discountCents).toBe(2000);
    const order = await shopper.checkout(`disc-${uuidv7()}`);
    expect(order.status).toBe(201);
    expect(order.body.totalCents).toBe(10000 - 2000 + 500);
    const second = new Shopper(app.url, merchant.slug);
    await second.addItem(product.variants[0]!.id, 2);
    const exhausted = await second.request('POST', '/v1/storefront/cart/discount', { code });
    expect(exhausted.status).toBe(422);
    await http(app.url, 'PATCH', `/v1/admin/products/${product.id}`, {
      headers: { ...merchant.headers, 'if-match': `"${product.version}"` },
      body: {
        variants: [
          {
            id: product.variants[0]!.id,
            sku: product.variants[0]!.sku,
            title: 'V',
            priceCents: 6000,
            onHand: 10,
          },
        ],
      },
    });
    const cart = await second.request('GET', '/v1/storefront/cart');
    expect(cart.body.items[0]).toMatchObject({
      unitPriceCents: 6000,
      previousUnitPriceCents: 5000,
      priceChanged: true,
    });
  });

  it('enforces the order state machine and refunds restock inventory', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 4 }] });
    const shopper = new Shopper(app.url, merchant.slug);
    await shopper.addItem(product.variants[0]!.id);
    const order = await shopper.checkout(`sm-${uuidv7()}`);
    const orderId = order.body.orderId as string;
    const early = await http(app.url, 'POST', `/v1/admin/orders/${orderId}/transitions`, {
      headers: merchant.headers,
      body: { to: 'fulfilled' },
    });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('INVALID_TRANSITION');
    await webhook(app, {
      id: `evt_${uuidv7()}`,
      type: 'payment.succeeded',
      intentId: order.body.payment.intentId,
      tenantId: merchant.tenantId,
      orderId,
      amountCents: order.body.totalCents,
    });
    const noKey = await http(app.url, 'POST', `/v1/admin/orders/${orderId}/refund`, {
      headers: merchant.headers,
      body: {},
    });
    expect(noKey.status).toBe(400);
    const fulfilled = await http(app.url, 'POST', `/v1/admin/orders/${orderId}/transitions`, {
      headers: merchant.headers,
      body: { to: 'fulfilled' },
    });
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.body.status).toBe('fulfilled');
    expect(fulfilled.body.allowedTransitions).toEqual(['delivered']);
    expect(await stock(admin, product.variants[0]!.id)).toEqual({ on_hand: 3, reserved: 0 });
    const key = `refund-${uuidv7()}`;
    const refunds = await Promise.all(
      [1, 2].map(() =>
        http(app.url, 'POST', `/v1/admin/orders/${orderId}/refund`, {
          headers: { ...merchant.headers, 'idempotency-key': key },
          body: {},
        }),
      ),
    );
    expect(refunds.some((r) => r.status === 200)).toBe(true);
    const detail = await http(app.url, 'GET', `/v1/admin/orders/${orderId}`, { headers: merchant.headers });
    expect(detail.body.status).toBe('refunded');
    expect(detail.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'pending_payment',
      'paid',
      'fulfilled',
      'refunded',
    ]);
    expect(await stock(admin, product.variants[0]!.id)).toEqual({ on_hand: 4, reserved: 0 });
    const events = await admin.query(
      'select event_type from outbox where aggregate_id = $1 order by created_at',
      [orderId],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual([
      'order.placed',
      'order.paid',
      'order.fulfilled',
      'order.refunded',
    ]);
  });

  it('expires reservations: the worker releases stock and cancels unpaid orders once', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 2 }] });
    const shopper = new Shopper(app.url, merchant.slug);
    await shopper.addItem(product.variants[0]!.id, 2);
    const order = await shopper.checkout(`exp-${uuidv7()}`);
    expect(await stock(admin, product.variants[0]!.id)).toEqual({ on_hand: 2, reserved: 2 });
    await admin.query(
      "update inventory_reservations set expires_at = now() - interval '1 minute' where order_id = $1",
      [order.body.orderId],
    );
    const pool = new pg.Pool({ connectionString: resources().databaseSystemUrl });
    try {
      const [first, second] = await Promise.all([expireReservations(pool), expireReservations(pool)]);
      expect(first + second).toBeGreaterThanOrEqual(1);
    } finally {
      await pool.end();
    }
    expect(await stock(admin, product.variants[0]!.id)).toEqual({ on_hand: 2, reserved: 0 });
    const detail = await http(app.url, 'GET', `/v1/admin/orders/${order.body.orderId}`, {
      headers: merchant.headers,
    });
    expect(detail.body.status).toBe('cancelled');
    expect(detail.body.history.at(-1).reason).toBe('payment_timeout');
    const cancelled = await admin.query(
      "select count(*)::int as n from outbox where aggregate_id = $1 and event_type = 'order.cancelled'",
      [order.body.orderId],
    );
    expect(cancelled.rows[0].n).toBe(1);
    const late = await webhook(app, {
      id: `evt_${uuidv7()}`,
      type: 'payment.succeeded',
      intentId: order.body.payment.intentId,
      tenantId: merchant.tenantId,
      orderId: order.body.orderId,
      amountCents: 1,
    });
    expect(late.body.outcome).toBe('ignored');
  });

  it('merges the anonymous cart into the customer cart on login', async () => {
    const product = await createProduct(app.url, merchant, { variants: [{ onHand: 20 }, { onHand: 20 }] });
    const shopper = new Shopper(app.url, merchant.slug);
    const register = await shopper.request('POST', '/v1/storefront/auth/register', {
      email: `c${Date.now()}@shop.dev`,
      password: 'password123',
      name: 'C',
    });
    expect(register.status).toBe(201);
    shopper.token = register.body.accessToken;
    await shopper.addItem(product.variants[0]!.id, 1);
    shopper.token = null;
    const guest = new Shopper(app.url, merchant.slug);
    await guest.addItem(product.variants[0]!.id, 2);
    await guest.addItem(product.variants[1]!.id, 1);
    const login = await guest.request('POST', '/v1/storefront/auth/login', {
      email: register.body.customer.email,
      password: 'password123',
    });
    expect(login.status).toBe(200);
    guest.token = login.body.accessToken;
    const cart = await guest.request('GET', '/v1/storefront/cart');
    const quantities = Object.fromEntries(
      cart.body.items.map((i: { variantId: string; quantity: number }) => [i.variantId, i.quantity]),
    );
    expect(quantities).toEqual({ [product.variants[0]!.id]: 3, [product.variants[1]!.id]: 1 });
    const identified = await admin.query(
      "select count(*)::int as n from outbox where event_type = 'customer.identified' and payload->>'anonymous_id' = $1",
      [guest.anonymousId],
    );
    expect(identified.rows[0].n).toBe(1);
    const history = await guest.request('GET', '/v1/storefront/account/orders');
    expect(history.status).toBe(200);
  });
});
