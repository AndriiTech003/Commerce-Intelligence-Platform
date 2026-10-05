import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProduct,
  http,
  signupMerchant,
  startApi,
  type Merchant,
  type TestApi,
} from './support/harness';

describe('catalog', () => {
  let app: TestApi;
  let merchant: Merchant;

  beforeAll(async () => {
    app = await startApi();
    merchant = await signupMerchant(app.url, 'cat');
  });

  afterAll(async () => {
    await app.close();
  });

  it('builds an ltree category tree, limits depth and moves subtrees on slug change', async () => {
    const post = (body: Record<string, unknown>) =>
      http(app.url, 'POST', '/v1/admin/categories', { headers: merchant.headers, body });
    const running = await post({ name: 'Running', slug: 'running' });
    const shoes = await post({ name: 'Running shoes', slug: 'running-shoes', parentId: running.body.id });
    const trail = await post({ name: 'Trail', slug: 'trail', parentId: shoes.body.id });
    expect(trail.body.path).toBe('running.running_shoes.trail');
    expect(trail.body.depth).toBe(3);
    const tooDeep = await post({ name: 'Deep', slug: 'deep', parentId: trail.body.id });
    expect(tooDeep.status).toBe(400);
    const renamed = await http(app.url, 'PATCH', `/v1/admin/categories/${running.body.id}`, {
      headers: merchant.headers,
      body: { slug: 'run' },
    });
    expect(renamed.body.path).toBe('run');
    const tree = await http(app.url, 'GET', '/v1/admin/categories', { headers: merchant.headers });
    expect(tree.body.data.map((c: { path: string }) => c.path)).toEqual([
      'run',
      'run.running_shoes',
      'run.running_shoes.trail',
    ]);
    const product = await http(app.url, 'POST', '/v1/admin/products', {
      headers: merchant.headers,
      body: {
        title: 'Trail Runner X',
        status: 'active',
        categoryId: trail.body.id,
        variants: [{ sku: 'TRX-1', title: '42', priceCents: 12900, onHand: 5 }],
      },
    });
    expect(product.status).toBe(201);
    const byParent = await http(app.url, 'GET', '/v1/storefront/catalog/products?category=run', {
      headers: { 'x-store': merchant.slug },
    });
    expect(byParent.body.data.map((p: { title: string }) => p.title)).toContain('Trail Runner X');
    expect(
      (await http(app.url, 'DELETE', `/v1/admin/categories/${shoes.body.id}`, { headers: merchant.headers }))
        .status,
    ).toBe(409);
  });

  it('optimistic locking: PATCH needs If-Match and returns 412 on a stale version', async () => {
    const product = await createProduct(app.url, merchant, { title: 'Locked item' });
    const missing = await http(app.url, 'PATCH', `/v1/admin/products/${product.id}`, {
      headers: merchant.headers,
      body: { title: 'x' },
    });
    expect(missing.status).toBe(428);
    const first = await http(app.url, 'PATCH', `/v1/admin/products/${product.id}`, {
      headers: { ...merchant.headers, 'if-match': `"${product.version}"` },
      body: { title: 'Locked item v2' },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('etag')).toBe(`"${first.body.version}"`);
    const stale = await http(app.url, 'PATCH', `/v1/admin/products/${product.id}`, {
      headers: { ...merchant.headers, 'if-match': `"${product.version}"` },
      body: { title: 'Lost update' },
    });
    expect(stale.status).toBe(412);
    expect(stale.body.errors[0].currentVersion).toBe(first.body.version);
  });

  it('searches with full text and trigram typo tolerance; suggests titles', async () => {
    await createProduct(app.url, merchant, { title: 'Velocity Cloud Runner' });
    await createProduct(app.url, merchant, { title: 'Mountain Hiking Boot' });
    const exact = await http(app.url, 'GET', '/v1/admin/products?q=runner', { headers: merchant.headers });
    expect(exact.body.data.some((p: { title: string }) => p.title === 'Velocity Cloud Runner')).toBe(true);
    const typo = await http(
      app.url,
      'GET',
      '/v1/storefront/catalog/products?q=velocty%20runer&sort=relevance',
      { headers: { 'x-store': merchant.slug } },
    );
    expect(typo.body.data[0].title).toBe('Velocity Cloud Runner');
    const suggest = await http(app.url, 'GET', '/v1/storefront/search/suggest?q=hikin', {
      headers: { 'x-store': merchant.slug },
    });
    expect(suggest.body.products[0].title).toBe('Mountain Hiking Boot');
  });

  it('paginates the storefront with cursors and filters by price and brand', async () => {
    const other = await signupMerchant(app.url, 'cat-pages');
    for (let i = 0; i < 7; i++) {
      await http(app.url, 'POST', '/v1/admin/products', {
        headers: other.headers,
        body: {
          title: `Item ${i}`,
          brand: i % 2 ? 'Odd' : 'Even',
          status: 'active',
          variants: [{ sku: `PG-${i}-${Date.now()}`, title: 'One', priceCents: 1000 + i * 100, onHand: 1 }],
        },
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { data: Array<{ id: string }>; nextCursor: string | null } } = await http(
        app.url,
        'GET',
        `/v1/storefront/catalog/products?limit=3&sort=price_asc${cursor ? `&cursor=${cursor}` : ''}`,
        { headers: { 'x-store': other.slug } },
      );
      seen.push(...res.body.data.map((p) => p.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    const filtered = await http(app.url, 'GET', '/v1/storefront/catalog/products?brand=Odd&priceMin=1200', {
      headers: { 'x-store': other.slug },
    });
    expect(filtered.body.data).toHaveLength(2);
    expect(filtered.body.facets.brands).toEqual([
      { value: 'Even', count: 3 },
      { value: 'Odd', count: 2 },
    ]);
  });

  it('serves product pages with ETag and 304 and hides drafts', async () => {
    const product = await createProduct(app.url, merchant, { title: 'Etag item' });
    const first = await http(app.url, 'GET', `/v1/storefront/catalog/products/${product.slug}`, {
      headers: { 'x-store': merchant.slug },
    });
    const etag = first.headers.get('etag')!;
    const second = await http(app.url, 'GET', `/v1/storefront/catalog/products/${product.slug}`, {
      headers: { 'x-store': merchant.slug, 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
    const draft = await createProduct(app.url, merchant, { title: 'Hidden draft', status: 'draft' });
    expect(
      (
        await http(app.url, 'GET', `/v1/storefront/catalog/products/${draft.slug}`, {
          headers: { 'x-store': merchant.slug },
        })
      ).status,
    ).toBe(404);
  });

  it('uploads images directly to MinIO with a presigned URL', async () => {
    const product = await createProduct(app.url, merchant, { title: 'Image item' });
    const ticket = await http(app.url, 'POST', `/v1/admin/products/${product.id}/images`, {
      headers: merchant.headers,
      body: { filename: 'shoe.svg', contentType: 'image/svg+xml', alt: 'Shoe' },
    });
    expect(ticket.status).toBe(201);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
    const put = await fetch(ticket.body.uploadUrl, {
      method: 'PUT',
      headers: ticket.body.headers,
      body: svg,
    });
    expect(put.status).toBe(200);
    const fetched = await fetch(ticket.body.image.url);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe(svg);
    const detail = await http(app.url, 'GET', `/v1/admin/products/${product.id}`, {
      headers: merchant.headers,
    });
    expect(detail.body.images).toHaveLength(1);
    expect(
      (
        await http(app.url, 'DELETE', `/v1/admin/products/${product.id}/images/${ticket.body.image.id}`, {
          headers: merchant.headers,
        })
      ).status,
    ).toBe(204);
  });

  it('serves the OpenAPI document with every route documented', async () => {
    const doc = await http(app.url, 'GET', '/openapi.json');
    expect(doc.status).toBe(200);
    for (const [path, methods] of Object.entries(
      doc.body.paths as Record<string, Record<string, { summary: string }>>,
    )) {
      for (const op of Object.values(methods)) expect(op.summary, path).not.toBe('');
    }
    expect(
      doc.body.paths['/v1/storefront/checkout'].post.parameters.some(
        (p: { name: string }) => p.name === 'Idempotency-Key',
      ),
    ).toBe(true);
  });
});
