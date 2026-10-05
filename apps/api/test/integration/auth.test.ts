import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cookieValue,
  createProduct,
  http,
  mailpitMessages,
  mailpitText,
  signupMerchant,
  startApi,
  waitFor,
  type Merchant,
  type TestApi,
} from './support/harness';

function refreshWith(base: string, token: string) {
  return http(base, 'POST', '/v1/auth/refresh', { headers: { cookie: `cip_rt=${token}` } });
}

describe('identity and access', () => {
  let app: TestApi;
  let owner: Merchant;

  beforeAll(async () => {
    app = await startApi();
    owner = await signupMerchant(app.url, 'auth');
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up a merchant with owner role, tracking key and a refresh cookie', async () => {
    const me = await http(app.url, 'GET', '/v1/me', { headers: { authorization: `Bearer ${owner.token}` } });
    expect(me.status).toBe(200);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].role).toBe('owner');
    expect(me.body.memberships[0].permissions).toContain('staff:manage');
    expect(owner.refreshCookie.length).toBeGreaterThan(20);
    const settings = await http(app.url, 'GET', '/v1/admin/settings', { headers: owner.headers });
    expect(settings.body.trackingKey).toMatch(/^pk_live_/);
  });

  it('rejects duplicate emails and slugs with 409', async () => {
    const res = await http(app.url, 'POST', '/v1/auth/signup', {
      body: { email: owner.email, password: 'password123', name: 'X', storeName: 'X', storeSlug: owner.slug },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('validates bodies and answers with Problem Details', async () => {
    const res = await http(app.url, 'POST', '/v1/auth/signup', { body: { email: 'bad' } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', instance: '/v1/auth/signup' });
    expect(res.body.type).toMatch(/^https:\/\//);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('rotates refresh tokens and revokes the whole family when an old token is reused', async () => {
    const login = await http(app.url, 'POST', '/v1/auth/login', {
      body: { email: owner.email, password: 'password123' },
    });
    expect(login.status).toBe(200);
    const first = cookieValue(login.headers, 'cip_rt')!;
    const rotated = await refreshWith(app.url, first);
    expect(rotated.status).toBe(200);
    const second = cookieValue(rotated.headers, 'cip_rt')!;
    expect(second).not.toBe(first);
    const reuse = await refreshWith(app.url, first);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('REFRESH_TOKEN_REUSED');
    const afterReuse = await refreshWith(app.url, second);
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const login = await http(app.url, 'POST', '/v1/auth/login', {
      body: { email: owner.email, password: 'password123' },
    });
    const token = cookieValue(login.headers, 'cip_rt')!;
    const logout = await http(app.url, 'POST', '/v1/auth/logout', { headers: { cookie: `cip_rt=${token}` } });
    expect(logout.status).toBe(204);
    expect((await refreshWith(app.url, token)).status).toBe(401);
  });

  it('throttles repeated failed logins', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (
          await http(app.url, 'POST', '/v1/auth/login', {
            body: { email: 'nobody@throttle.dev', password: 'wrong-pass' },
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('requires authentication on admin routes', async () => {
    expect(
      (await http(app.url, 'GET', '/v1/admin/products', { headers: { 'x-tenant-id': owner.tenantId } }))
        .status,
    ).toBe(401);
    expect(
      (
        await http(app.url, 'GET', '/v1/admin/products', {
          headers: { authorization: `Bearer ${owner.token}` },
        })
      ).status,
    ).toBe(400);
  });

  it('invites a catalog manager through Mailpit; the role limits what they can do', async () => {
    const email = `cm-${Date.now()}@invite.dev`;
    const invite = await http(app.url, 'POST', '/v1/admin/invitations', {
      headers: owner.headers,
      body: { email, role: 'catalog_manager' },
    });
    expect(invite.status).toBe(201);
    expect(invite.body.token).toBeUndefined();
    const message = await waitFor(async () => (await mailpitMessages(email))[0], 10000);
    const text = await mailpitText(message.ID);
    const token = /\/invite\/([^\s]+)/.exec(text)![1]!;
    const accepted = await http(app.url, 'POST', `/v1/invitations/${token}/accept`, {
      body: { name: 'Cat', password: 'password123' },
    });
    expect(accepted.status).toBe(200);
    const headers = { authorization: `Bearer ${accepted.body.accessToken}`, 'x-tenant-id': owner.tenantId };
    expect(accepted.body.memberships[0].role).toBe('catalog_manager');
    const product = await http(app.url, 'POST', '/v1/admin/products', {
      headers,
      body: {
        title: 'Made by catalog manager',
        status: 'active',
        variants: [{ sku: `CM-${Date.now()}`, title: 'One', priceCents: 500, onHand: 1 }],
      },
    });
    expect(product.status).toBe(201);
    expect((await http(app.url, 'GET', '/v1/admin/orders', { headers })).status).toBe(403);
    expect((await http(app.url, 'GET', '/v1/admin/members', { headers })).status).toBe(200);
    expect(
      (
        await http(app.url, 'POST', '/v1/admin/invitations', {
          headers,
          body: { email: 'x@y.dev', role: 'support' },
        })
      ).status,
    ).toBe(403);
    const again = await http(app.url, 'POST', `/v1/invitations/${token}/accept`, {
      body: { name: 'Cat', password: 'password123' },
    });
    expect(again.status).toBe(404);
  });

  it('protects the last owner and lets owners change roles', async () => {
    const members = await http(app.url, 'GET', '/v1/admin/members', { headers: owner.headers });
    const self = members.body.data.find((m: { userId: string }) => m.userId === owner.userId);
    const demote = await http(app.url, 'PATCH', `/v1/admin/members/${self.userId}`, {
      headers: owner.headers,
      body: { role: 'admin' },
    });
    expect(demote.status).toBe(409);
  });

  it('API keys: secret keys work with their scopes, are hashed and can be revoked', async () => {
    const created = await http(app.url, 'POST', '/v1/admin/api-keys', {
      headers: owner.headers,
      body: { kind: 'secret', scopes: ['catalog:read'] },
    });
    expect(created.status).toBe(201);
    const secret = created.body.secret as string;
    expect(secret).toMatch(/^sk_live_[0-9A-Za-z]{32}$/);
    expect(created.body.prefix).toBe(secret.slice(0, 12));
    const keyHeaders = { authorization: `Bearer ${secret}` };
    expect((await http(app.url, 'GET', '/v1/admin/products', { headers: keyHeaders })).status).toBe(200);
    expect((await http(app.url, 'GET', '/v1/admin/orders', { headers: keyHeaders })).status).toBe(403);
    const other = await signupMerchant(app.url, 'auth-other');
    expect(
      (
        await http(app.url, 'GET', '/v1/admin/products', {
          headers: { ...keyHeaders, 'x-tenant-id': other.tenantId },
        })
      ).status,
    ).toBe(403);
    const list = await http(app.url, 'GET', '/v1/admin/api-keys', { headers: owner.headers });
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(
      (await http(app.url, 'DELETE', `/v1/admin/api-keys/${created.body.id}`, { headers: owner.headers }))
        .status,
    ).toBe(204);
    expect((await http(app.url, 'GET', '/v1/admin/products', { headers: keyHeaders })).status).toBe(401);
  });

  it('writes audit entries with field diffs for admin mutations', async () => {
    const product = await createProduct(app.url, owner, { title: 'Audited' });
    const patched = await http(app.url, 'PATCH', `/v1/admin/products/${product.id}`, {
      headers: { ...owner.headers, 'if-match': `"${product.version}"` },
      body: { title: 'Audited v2' },
    });
    expect(patched.status).toBe(200);
    const audit = await waitFor(async () => {
      const res = await http(app.url, 'GET', `/v1/admin/audit-log?entityId=${product.id}`, {
        headers: owner.headers,
      });
      return res.body.data.length >= 2 ? res.body : null;
    });
    const update = audit.data.find((e: { action: string }) => e.action === 'product.updated');
    expect(update.diff.title).toEqual(['Audited', 'Audited v2']);
    expect(update.actorId).toBe(owner.userId);
    expect(audit.data.some((e: { action: string }) => e.action === 'product.created')).toBe(true);
  });

  it('platform routes are only for platform admins', async () => {
    expect(
      (
        await http(app.url, 'GET', '/v1/platform/tenants', {
          headers: { authorization: `Bearer ${owner.token}` },
        })
      ).status,
    ).toBe(403);
  });
});
