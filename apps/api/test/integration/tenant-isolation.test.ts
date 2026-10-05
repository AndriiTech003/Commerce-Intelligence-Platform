import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { TENANT_TABLES } from '../../src/db/schema';
import {
  createProduct,
  http,
  resources,
  Shopper,
  signupMerchant,
  startApi,
  type Merchant,
  type TestApi,
} from './support/harness';

async function seedEveryTable(admin: pg.Client, tenantId: string): Promise<void> {
  const id = () => uuidv7();
  const userId = id();
  const categoryId = id();
  const productId = id();
  const variantId = id();
  const customerId = id();
  const cartId = id();
  const orderId = id();
  const campaignId = id();
  await admin.query(`insert into users (id, email, name, password_hash) values ($1, $2, 'U', 'x')`, [
    userId,
    `${userId}@iso.dev`,
  ]);
  const q = async (sql: string, params: unknown[]) => admin.query(sql, params);
  await q(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'support')`, [
    tenantId,
    userId,
  ]);
  await q(
    `insert into invitations (id, tenant_id, email, role, token_hash, expires_at) values ($1, $2, 'i@x.dev', 'support', $3, now() + interval '1 day')`,
    [id(), tenantId, id()],
  );
  await q(
    `insert into api_keys (id, tenant_id, kind, prefix, key_hash) values ($1, $2, 'secret', 'sk_live_xxxx', $3)`,
    [id(), tenantId, id()],
  );
  await q(
    `insert into audit_log (id, tenant_id, actor_type, action, entity_type) values ($1, $2, 'system', 'x', 'y')`,
    [id(), tenantId],
  );
  await q(
    `insert into tenant_counters (tenant_id, name, value) values ($1, 'iso', 1) on conflict do nothing`,
    [tenantId],
  );
  await q(`insert into categories (id, tenant_id, name, slug, path) values ($1, $2, 'C', $3, 'iso')`, [
    categoryId,
    tenantId,
    `iso-${categoryId.slice(-6)}`,
  ]);
  await q(
    `insert into products (id, tenant_id, category_id, title, slug, status) values ($1, $2, $3, 'Iso product', $4, 'active')`,
    [productId, tenantId, categoryId, `iso-${productId.slice(-8)}`],
  );
  await q(
    `insert into product_images (id, tenant_id, product_id, storage_key, position) values ($1, $2, $3, 'k', 0)`,
    [id(), tenantId, productId],
  );
  await q(
    `insert into product_variants (id, tenant_id, product_id, sku, title, price_cents, currency) values ($1, $2, $3, $4, 'V', 100, 'USD')`,
    [variantId, tenantId, productId, `ISO-${variantId.slice(-8)}`],
  );
  await q(`insert into inventory_items (variant_id, tenant_id, on_hand) values ($1, $2, 5)`, [
    variantId,
    tenantId,
  ]);
  await q(
    `insert into inventory_reservations (id, tenant_id, order_id, variant_id, quantity, status, expires_at) values ($1, $2, $3, $4, 1, 'released', now())`,
    [id(), tenantId, orderId, variantId],
  );
  await q(
    `insert into inventory_movements (id, tenant_id, variant_id, delta, reason) values ($1, $2, $3, 1, 'import')`,
    [id(), tenantId, variantId],
  );
  await q(`insert into customers (id, tenant_id, email) values ($1, $2, $3)`, [
    customerId,
    tenantId,
    `${customerId}@iso.dev`,
  ]);
  await q(`insert into carts (id, tenant_id, customer_id) values ($1, $2, $3)`, [
    cartId,
    tenantId,
    customerId,
  ]);
  await q(`insert into cart_items (cart_id, variant_id, tenant_id, quantity) values ($1, $2, $3, 1)`, [
    cartId,
    variantId,
    tenantId,
  ]);
  await q(`insert into discounts (id, tenant_id, code, type, value) values ($1, $2, $3, 'percent', 10)`, [
    id(),
    tenantId,
    `ISO${orderId.slice(-6)}`,
  ]);
  await q(
    `insert into orders (id, tenant_id, number, email, status, currency, subtotal_cents, total_cents, shipping_address, idempotency_key)
     values ($1, $2, 1, 'o@x.dev', 'paid', 'USD', 100, 100, '{}', $3)`,
    [orderId, tenantId, id()],
  );
  await q(
    `insert into order_items (id, tenant_id, order_id, variant_id, product_id, title_snapshot, sku_snapshot, unit_price_cents, quantity) values ($1, $2, $3, $4, $5, 't', 's', 100, 1)`,
    [id(), tenantId, orderId, variantId, productId],
  );
  await q(
    `insert into order_status_history (id, tenant_id, order_id, to_status) values ($1, $2, $3, 'paid')`,
    [id(), tenantId, orderId],
  );
  await q(
    `insert into payments (id, tenant_id, order_id, provider, provider_ref, status, amount_cents) values ($1, $2, $3, 'fake', $4, 'succeeded', 100)`,
    [id(), tenantId, orderId, id()],
  );
  await q(`insert into jobs (id, tenant_id, type, status) values ($1, $2, 'import', 'queued')`, [
    id(),
    tenantId,
  ]);
  await q(`insert into segments (id, tenant_id, key, name, rules) values ($1, $2, $3, 'S', '{}')`, [
    id(),
    tenantId,
    `seg-${id().slice(-6)}`,
  ]);
  await q(
    `insert into campaigns (id, tenant_id, name, placement, status, target_segments, product_selector, goal) values ($1, $2, 'C', 'home_hero', 'draft', '{}', '{}', 'click')`,
    [campaignId, tenantId],
  );
  await q(
    `insert into creatives (id, tenant_id, campaign_id, headline, body, cta, status, source) values ($1, $2, $3, 'h', 'b', 'c', 'draft', 'human')`,
    [id(), tenantId, campaignId],
  );
  await q(
    `insert into bandit_snapshots (campaign_id, segment_key, creative_id, tenant_id, alpha, beta, impressions, successes) values ($1, 'all', $2, $3, 1, 1, 0, 0)`,
    [campaignId, id(), tenantId],
  );
  await q(
    `insert into customer_profiles (tenant_id, profile_id, features, updated_at) values ($1, $2, '{}', now())`,
    [tenantId, id()],
  );
  const endpointId = id();
  await q(
    `insert into webhook_endpoints (id, tenant_id, url, events, secret, secret_prefix) values ($1, $2, 'http://127.0.0.1:9/x', '{order.paid}', 's', 'whsec_x')`,
    [endpointId, tenantId],
  );
  await q(
    `insert into webhook_deliveries (id, tenant_id, endpoint_id, event_id, event_type, payload) values ($1, $2, $3, $4, 'order.paid', '{}')`,
    [id(), tenantId, endpointId, id()],
  );
  await q(
    `insert into fake_payment_webhooks (id, tenant_id, intent_id, body, status, due_at) values ($1, $2, $3, '{}', 'delivered', now())`,
    [id(), tenantId, `pi_fake_iso_${id()}`],
  );
}

describe('tenant isolation (RLS)', () => {
  let app: TestApi;
  let a: Merchant;
  let b: Merchant;
  let admin: pg.Client;

  beforeAll(async () => {
    app = await startApi();
    a = await signupMerchant(app.url, 'iso-a');
    b = await signupMerchant(app.url, 'iso-b');
    admin = new pg.Client({ connectionString: resources().databaseAdminUrl });
    await admin.connect();
    await seedEveryTable(admin, a.tenantId);
    await seedEveryTable(admin, b.tenantId);
  });

  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  async function asAppUser<T>(tenantId: string | null, fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: resources().databaseUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query('ROLLBACK');
      return result;
    } finally {
      await client.end();
    }
  }

  it('covers every tenant table with FORCE RLS and a policy', async () => {
    const { rows } = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: number;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity, (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const withTenantColumn = await admin.query<{ table_name: string }>(
      `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'`,
    );
    const global = new Set(['outbox', 'refresh_tokens']);
    const expected = withTenantColumn.rows
      .map((r) => r.table_name)
      .filter((t) => !global.has(t))
      .sort();
    expect(expected).toEqual([...TENANT_TABLES].sort());
    for (const table of TENANT_TABLES) {
      const row = rows.find((r) => r.relname === table);
      expect(row, table).toBeDefined();
      expect(row!.relrowsecurity && row!.relforcerowsecurity, table).toBe(true);
      expect(row!.policies, table).toBeGreaterThan(0);
    }
  });

  for (const table of TENANT_TABLES) {
    it(`${table}: an unfiltered select in tenant A context sees only A rows`, async () => {
      const tenants = await asAppUser(a.tenantId, async (client) => {
        const { rows } = await client.query<{ tenant_id: string }>(`select tenant_id from ${table}`);
        return rows.map((r) => r.tenant_id);
      });
      expect(tenants.length, `${table} has rows for A`).toBeGreaterThan(0);
      expect(new Set(tenants)).toEqual(new Set([a.tenantId]));
      const total = await admin.query<{ n: number }>(
        `select count(*)::int as n from ${table} where tenant_id = $1`,
        [b.tenantId],
      );
      expect(total.rows[0]!.n, `${table} has rows for B`).toBeGreaterThan(0);
    });
  }

  it('fails instead of leaking when the tenant context is missing', async () => {
    await expect(asAppUser(null, (client) => client.query('select * from products'))).rejects.toThrow(
      /app\.tenant_id/,
    );
  });

  it('rejects inserting a row with another tenant id (policy WITH CHECK)', async () => {
    await expect(
      asAppUser(a.tenantId, (client) =>
        client.query(
          `insert into discounts (id, tenant_id, code, type, value) values ($1, $2, 'EVIL', 'percent', 5)`,
          [uuidv7(), b.tenantId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete rows of another tenant', async () => {
    const result = await asAppUser(a.tenantId, async (client) => {
      const updated = await client.query(`update products set title = 'hacked' where tenant_id = $1`, [
        b.tenantId,
      ]);
      const deleted = await client.query(`delete from orders where tenant_id = $1`, [b.tenantId]);
      return [updated.rowCount, deleted.rowCount];
    });
    expect(result).toEqual([0, 0]);
  });

  it('API: staff of A with X-Tenant-Id of B gets 403', async () => {
    const res = await http(app.url, 'GET', '/v1/admin/products', {
      headers: { ...a.headers, 'x-tenant-id': b.tenantId },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('API: an order id of B is not visible to A even with a direct URL', async () => {
    const product = await createProduct(app.url, b, { variants: [{ onHand: 5 }] });
    const shopper = new Shopper(app.url, b.slug);
    await shopper.addItem(product.variants[0]!.id);
    const order = await shopper.checkout(`iso-key-${uuidv7()}`);
    expect(order.status).toBe(201);
    const leak = await http(app.url, 'GET', `/v1/admin/orders/${order.body.orderId}`, { headers: a.headers });
    expect(leak.status).toBe(404);
    const own = await http(app.url, 'GET', `/v1/admin/orders/${order.body.orderId}`, { headers: b.headers });
    expect(own.status).toBe(200);
  });

  it('API: a storefront of A cannot read products of B by slug', async () => {
    const product = await createProduct(app.url, b);
    const res = await http(app.url, 'GET', `/v1/storefront/catalog/products/${product.slug}`, {
      headers: { 'x-store': a.slug },
    });
    expect(res.status).toBe(404);
  });
});
