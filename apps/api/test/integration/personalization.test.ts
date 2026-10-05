import pg from 'pg';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redisKeys, uuidv7 } from '@cip/contracts';
import {
  decayedScore,
  embeddingText,
  hashEmbedding,
  parseProfileHash,
  vectorLiteral,
  type ProfileEvent,
} from '@cip/personalization';
import { ProfileUpdater } from '../../../stream-worker/src/profiles';
import { loadConfig as loadDomainConfig } from '../../../domain-worker/src/config';
import { startDomainWorker, type DomainWorker } from '../../../domain-worker/src/worker';
import {
  CANDIDATE_QUERIES,
  ProfileSnapshotService,
  type CandidateQueries,
} from '../../src/modules/personalization';
import { UNIT_OF_WORK, type UnitOfWork } from '../../src/modules/tenancy';
import {
  createProduct,
  http,
  resources,
  signupMerchant,
  startApi,
  waitFor,
  type Merchant,
  type TestApi,
} from './support/harness';

const HOUR = 3600_000;

async function embedAll(admin: pg.Client, tenantId: string) {
  const { rows } = await admin.query<{
    id: string;
    title: string;
    brand: string | null;
    description: string;
  }>('select id, title, brand, description from products where tenant_id = $1', [tenantId]);
  for (const row of rows) {
    const vector = hashEmbedding(
      embeddingText({ title: row.title, brand: row.brand, description: row.description }),
    );
    await admin.query(
      `update products set embedding = $1::vector, embedding_version = 'test' where id = $2`,
      [vectorLiteral(vector), row.id],
    );
  }
}

describe('personalization: pgvector, profiles, segments, recommendations', () => {
  let app: TestApi;
  let a: Merchant;
  let b: Merchant;
  let admin: pg.Client;
  let redis: Redis;
  let updater: ProfileUpdater;
  const keys = () => redisKeys(resources().redisPrefix);

  beforeAll(async () => {
    const r = resources();
    app = await startApi({ RECO_CACHE_SECONDS: '300' });
    a = await signupMerchant(app.url, 'pa');
    b = await signupMerchant(app.url, 'pb');
    admin = new pg.Client({ connectionString: r.databaseAdminUrl });
    await admin.connect();
    redis = new Redis(r.redisUrl);
    updater = new ProfileUpdater(redis, keys());
  });

  afterAll(async () => {
    redis.disconnect();
    await admin.end();
    await app.close();
  });

  it('pgvector kNN never returns another tenant’s products, even with identical embeddings', async () => {
    const titles = ['Velocity Swift Runner', 'Velocity Swift Tempo', 'Arclight Trail Boot'];
    const productsA: Array<{ id: string }> = [];
    for (const title of titles) productsA.push(await createProduct(app.url, a, { title }));
    for (const title of titles) await createProduct(app.url, b, { title });
    await embedAll(admin, a.tenantId);
    await embedAll(admin, b.tenantId);
    const uow = app.api.app.get<UnitOfWork>(UNIT_OF_WORK);
    const queries = app.api.app.get<CandidateQueries>(CANDIDATE_QUERIES);
    const vector = hashEmbedding(
      embeddingText({ title: 'Velocity Swift Runner', brand: null, description: 'Test product' }),
    );
    const nearest = await uow.runForTenant(a.tenantId, () => queries.nearest(vector, 10, []));
    const idsA = new Set(productsA.map((p) => p.id));
    expect(nearest.length).toBe(3);
    expect(nearest.every((n) => idsA.has(n.id))).toBe(true);
    expect(nearest[0]!.score).toBeGreaterThan(0.99);
    const similar = await http(
      app.url,
      'GET',
      `/v1/storefront/recommendations?type=similar&productId=${productsA[0]!.id}&limit=5`,
      {
        headers: { 'x-store': a.slug, 'x-anonymous-id': uuidv7() },
      },
    );
    expect(similar.status).toBe(200);
    expect(similar.body.items.length).toBeGreaterThan(0);
    for (const item of similar.body.items) expect(idsA.has(item.id)).toBe(true);
    expect(similar.body.items[0].strategies).toContain('vector_item');
    const crossTenant = await uow.runForTenant(b.tenantId, () => queries.byIds(productsA.map((p) => p.id)));
    expect(crossTenant).toEqual([]);
  });

  it('domain-worker embeds products from product.upserted with embedding_version', async () => {
    const r = resources();
    const domain: DomainWorker = await startDomainWorker(
      loadDomainConfig({
        LOG_LEVEL: 'silent',
        DATABASE_SYSTEM_URL: r.databaseSystemUrl,
        REDIS_URL: r.redisUrl,
        REDIS_PREFIX: r.redisPrefix,
        RABBITMQ_URL: r.rabbitUrl,
        SMTP_PORT: String(r.smtpPort),
        EMBEDDINGS_PROVIDER: 'hash',
        EMBEDDINGS_FLUSH_MS: '50',
        RESERVATION_EXPIRY_INTERVAL_MS: '600000',
      }),
      { opsServer: false },
    );
    try {
      const product = await createProduct(app.url, a, { title: 'Embedded Glide 3' });
      const row = await waitFor(async () => {
        const { rows } = await admin.query<{ embedding_version: string | null; dims: number | null }>(
          'select embedding_version, vector_dims(embedding) as dims from products where id = $1',
          [product.id],
        );
        return rows[0]?.embedding_version ? rows[0] : null;
      }, 20000);
      expect(row.embedding_version).toBe('hash:feature-hashing-v1:384');
      expect(row.dims).toBe(384);
      const before = await admin.query('select embedding_source_hash from products where id = $1', [
        product.id,
      ]);
      expect(await domain.embedder.embedProducts([product.id])).toBe(0);
      const after = await admin.query('select embedding_source_hash from products where id = $1', [
        product.id,
      ]);
      expect(after.rows[0]).toEqual(before.rows[0]);
      const re = await domain.embedder.reembed({ all: true, tenantId: a.tenantId });
      expect(re.embedded).toBe(re.total);
    } finally {
      await domain.stop();
    }
  });

  it('profile Lua: commutative updates, per-event dedupe and identity stitching', async () => {
    const now = Date.now();
    const events: ProfileEvent[] = Array.from({ length: 12 }, (_, i) => ({
      id: uuidv7(),
      k: i % 4 === 0 ? 'add_to_cart' : 'view',
      t: now - (12 - i) * 7 * HOUR,
      pid: uuidv7(),
      cat: i % 3 === 0 ? 'hiking.backpacks' : 'running.running_shoes.road_shoes',
      brand: i % 2 ? 'Stridewell' : 'Velocity',
      price: 9000 + i * 100,
      sid: 's1',
    }));
    const p1 = uuidv7();
    const p2 = uuidv7();
    await updater.applyUpdates(a.tenantId, p1, events);
    const shuffled = [...events].sort((x, y) => x.id.localeCompare(y.id) * -1);
    for (let i = 0; i < shuffled.length; i += 5)
      await updater.applyUpdates(
        a.tenantId,
        p2,
        shuffled.slice(i, i + 5).map((e) => ({ ...e, id: uuidv7() })),
      );
    const s1 = parseProfileHash(p1, await redis.hgetall(keys().profile(a.tenantId, p1)));
    const s2 = parseProfileHash(p2, await redis.hgetall(keys().profile(a.tenantId, p2)));
    for (const path of Object.keys(s1.categories)) {
      expect(decayedScore(s2.categories[path]!, now)).toBeCloseTo(decayedScore(s1.categories[path]!, now), 6);
    }
    expect(Object.keys(s1.categories).sort()).toEqual([
      'hiking',
      'hiking.backpacks',
      'running',
      'running.running_shoes',
      'running.running_shoes.road_shoes',
    ]);
    expect(await updater.applyUpdates(a.tenantId, p1, events.slice(0, 3))).toBe(0);
    const again = parseProfileHash(p1, await redis.hgetall(keys().profile(a.tenantId, p1)));
    expect(again.categories.running).toEqual(s1.categories.running);
    expect(await redis.ttl(keys().profile(a.tenantId, p1))).toBeGreaterThan(80 * 86400);
    expect(await redis.sismember(keys().profileDirty(a.tenantId), p1)).toBe(1);

    const anonymous = uuidv7();
    const customer = uuidv7();
    await updater.applyUpdates(a.tenantId, anonymous, [
      { id: uuidv7(), k: 'view', t: now, pid: uuidv7(), cat: 'hiking.boots', price: 15000, sid: 'x' },
    ]);
    await updater.applyUpdates(a.tenantId, customer, [
      { id: uuidv7(), k: 'view', t: now - HOUR, pid: uuidv7(), cat: 'hiking.boots', price: 14000, sid: 'y' },
    ]);
    expect(await updater.merge(a.tenantId, anonymous, customer)).toBeGreaterThan(0);
    expect(await updater.merge(a.tenantId, anonymous, customer)).toBe(0);
    expect(await redis.hget(keys().profile(a.tenantId, anonymous), 'alias')).toBe(customer);
    await updater.applyUpdates(a.tenantId, anonymous, [
      { id: uuidv7(), k: 'add_to_cart', t: now, pid: uuidv7(), cat: 'hiking.boots', price: 15000, sid: 'x' },
    ]);
    const merged = parseProfileHash(customer, await redis.hgetall(keys().profile(a.tenantId, customer)));
    expect(decayedScore(merged.categories['hiking.boots']!, now)).toBeCloseTo(
      1 + Math.pow(2, -1 / 168) + 3,
      4,
    );
    expect(merged.customerId).toBe(customer);
    expect(Object.keys(merged.sessions).sort()).toEqual(['x', 'y']);
  });

  it('snapshots dirty profiles to Postgres and restores them after Redis loss', async () => {
    const profileId = uuidv7();
    await updater.applyUpdates(a.tenantId, profileId, [
      { id: uuidv7(), k: 'view', t: Date.now(), pid: uuidv7(), cat: 'running.trail', price: 12000, sid: 's' },
      {
        id: uuidv7(),
        k: 'add_to_cart',
        t: Date.now(),
        pid: uuidv7(),
        cat: 'running.trail',
        price: 12000,
        sid: 's',
      },
    ]);
    const service = app.api.app.get(ProfileSnapshotService);
    expect(await service.flushTenant(a.tenantId)).toBeGreaterThan(0);
    const { rows } = await admin.query<{ features: Record<string, unknown>; segments: string[] }>(
      'select features, segments from customer_profiles where profile_id = $1',
      [profileId],
    );
    expect(rows[0]!.features['aff.cat.running']).toBe(4);
    expect(rows[0]!.segments).toContain('new_visitor');
    await redis.del(keys().profile(a.tenantId, profileId));
    const restored = await http(app.url, 'GET', `/v1/admin/profiles/${profileId}`, { headers: a.headers });
    expect(restored.status).toBe(200);
    expect(restored.body.source).toBe('snapshot');
    expect(restored.body.features['aff.cat.running']).toBe(4);
    const live = await http(app.url, 'GET', `/v1/admin/profiles/${profileId}`, { headers: a.headers });
    expect(live.body.source).toBe('live');
  });

  it('segments: validated CRUD, system segments protected, preview over snapshots', async () => {
    const list = await http(app.url, 'GET', '/v1/admin/segments', { headers: a.headers });
    expect(
      list.body.data.filter((s: { isSystem: boolean }) => s.isSystem).map((s: { key: string }) => s.key),
    ).toEqual(['high_intent', 'vip', 'lapsed', 'price_sensitive', 'returning_customer', 'new_visitor']);
    const bad = await http(app.url, 'POST', '/v1/admin/segments', {
      headers: a.headers,
      body: { key: 'bad', name: 'Bad', rules: { all: [{ feature: 'intent', op: 'gte', value: 'high' }] } },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toContain('rules');
    const created = await http(app.url, 'POST', '/v1/admin/segments', {
      headers: a.headers,
      body: {
        key: 'trail_fans',
        name: 'Trail fans',
        priority: 15,
        rules: { all: [{ feature: 'aff.cat.running', op: 'gte', value: 3 }] },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.description).toBe('aff.cat.running ≥ 3');
    const preview = await http(app.url, 'POST', '/v1/admin/segments/preview', {
      headers: a.headers,
      body: {
        rules: {
          any: [
            { feature: 'aff.cat.running', op: 'gte', value: 3 },
            { feature: 'intent', op: 'gte', value: 0.99 },
          ],
        },
      },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBeGreaterThanOrEqual(1);
    expect(preview.body.sample[0].reasons[0]).toMatch(/^aff\.cat\.running = /);
    const system = list.body.data.find((s: { key: string }) => s.key === 'high_intent');
    expect(
      (await http(app.url, 'DELETE', `/v1/admin/segments/${system.id}`, { headers: a.headers })).status,
    ).toBe(409);
    const otherTenant = await http(app.url, 'GET', '/v1/admin/segments', { headers: b.headers });
    expect(otherTenant.body.data.some((s: { key: string }) => s.key === 'trail_fans')).toBe(false);
    expect(
      (await http(app.url, 'DELETE', `/v1/admin/segments/${created.body.id}`, { headers: a.headers })).status,
    ).toBe(204);
  });

  it('segment preview and member counts see live profile changes without waiting for the snapshot job', async () => {
    const rules = { all: [{ feature: 'aff.cat.kayaking', op: 'gte', value: 3 }] };
    const before = await http(app.url, 'POST', '/v1/admin/segments/preview', {
      headers: a.headers,
      body: { rules },
    });
    expect(before.status).toBe(200);
    const created = await http(app.url, 'POST', '/v1/admin/segments', {
      headers: a.headers,
      body: { key: 'kayakers', name: 'Kayakers', priority: 16, rules },
    });
    expect(created.status).toBe(201);
    const profileId = uuidv7();
    await updater.applyUpdates(a.tenantId, profileId, [
      {
        id: uuidv7(),
        k: 'add_to_cart',
        t: Date.now(),
        pid: uuidv7(),
        cat: 'kayaking.boats',
        price: 90000,
        sid: 'k',
      },
      {
        id: uuidv7(),
        k: 'view',
        t: Date.now(),
        pid: uuidv7(),
        cat: 'kayaking.boats',
        price: 90000,
        sid: 'k',
      },
    ]);
    const after = await http(app.url, 'POST', '/v1/admin/segments/preview', {
      headers: a.headers,
      body: { rules },
    });
    expect(after.body.count).toBe(before.body.count + 1);
    expect(after.body.sample.map((s: { profileId: string }) => s.profileId)).toContain(profileId);
    const list = await http(app.url, 'GET', '/v1/admin/segments', { headers: a.headers });
    expect(list.body.data.find((s: { key: string }) => s.key === 'kayakers').members).toBe(1);
    await http(app.url, 'DELETE', `/v1/admin/segments/${created.body.id}`, { headers: a.headers });
  });

  it('“For you” changes after five views of running shoes and explains its contributions', async () => {
    const shoes = [];
    for (let i = 0; i < 5; i++) shoes.push(await createProduct(app.url, a, { title: `Road Racer ${i}` }));
    const category = await http(app.url, 'POST', '/v1/admin/categories', {
      headers: a.headers,
      body: { name: 'Running', slug: 'running' },
    });
    await admin.query('update products set category_id = $1 where id = any($2::uuid[])', [
      category.body.id,
      shoes.map((s) => s.id),
    ]);
    await embedAll(admin, a.tenantId);
    const visitor = uuidv7();
    const headers = { 'x-store': a.slug, 'x-anonymous-id': visitor };
    const cold = await http(app.url, 'GET', '/v1/storefront/recommendations?type=for_you&limit=6', {
      headers,
    });
    expect(cold.status).toBe(200);
    expect(cold.body.coldStart).toBe(true);
    expect(cold.body.items[0].strategies).toEqual(['global_popular']);
    await updater.applyUpdates(
      a.tenantId,
      visitor,
      shoes.map((s, i) => ({
        id: uuidv7(),
        k: 'view' as const,
        t: Date.now() - i * 1000,
        pid: s.id,
        cat: 'running',
        price: 1000,
        sid: 's',
      })),
    );
    const warm = await http(app.url, 'GET', '/v1/storefront/recommendations?type=for_you&limit=6', {
      headers,
    });
    expect(warm.body.coldStart).toBe(false);
    expect(warm.body.cached).toBe(false);
    const strategies = new Set(warm.body.items.flatMap((i: { strategies: string[] }) => i.strategies));
    expect(strategies.has('affinity_popular') || strategies.has('vector_profile')).toBe(true);
    const top = warm.body.items[0];
    const sum = Object.values(top.contributions as Record<string, number>).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(top.score, 3);
    const cached = await http(app.url, 'GET', '/v1/storefront/recommendations?type=for_you&limit=6', {
      headers,
    });
    expect(cached.body.cached).toBe(true);
    await updater.applyUpdates(a.tenantId, visitor, [
      {
        id: uuidv7(),
        k: 'add_to_cart',
        t: Date.now(),
        pid: shoes[0]!.id,
        cat: 'running',
        price: 1000,
        sid: 's',
      },
    ]);
    const invalidated = await http(app.url, 'GET', '/v1/storefront/recommendations?type=for_you&limit=6', {
      headers,
    });
    expect(invalidated.body.cached).toBe(false);
    const profile = await http(app.url, 'GET', `/v1/admin/profiles/${visitor}`, { headers: a.headers });
    expect(profile.body.affinity.categories[0].key).toBe('running');
    expect(profile.body.segments.map((s: { key: string }) => s.key)).toContain('new_visitor');
  });
});
