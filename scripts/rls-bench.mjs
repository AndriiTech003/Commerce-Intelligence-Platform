import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { provision, stackEnv, teardown, waitHealthy } from './stack.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.RLS_BENCH_OUT ?? join(root, 'docs', 'assets');
const SQL_ITERATIONS = Number(process.env.SQL_ITERATIONS ?? 2000);
const SQL_WARMUP = Number(process.env.SQL_WARMUP ?? 200);
const HTTP_ITERATIONS = Number(process.env.HTTP_ITERATIONS ?? 600);
const HTTP_WARMUP = Number(process.env.HTTP_WARMUP ?? 60);
const CLONES = Number(process.env.CLONE_TENANTS ?? 38);
const ORDERS_PER_TENANT = Number(process.env.ORDERS_PER_TENANT ?? 2000);
const BOOTSTRAP = Number(process.env.BOOTSTRAP ?? 2000);
const BLOCKS = 4;
const PORT_RLS = Number(process.env.RLS_BENCH_PORT_RLS ?? 4178);
const PORT_PLAIN = Number(process.env.RLS_BENCH_PORT_PLAIN ?? 4179);
const SKIP_HTTP = process.env.SKIP_HTTP === '1';
const NAME = process.env.RLS_BENCH_NAME ?? 'rls-bench';
const LABEL = process.env.RLS_BENCH_LABEL ?? '';

function log(message) {
  process.stdout.write(`rls-bench: ${message}\n`);
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seeded(20261005);
const pick = (list) => list[Math.floor(rand() * list.length)];
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    n: values.length,
    mean,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
  };
}

function bootstrapRatio(a, b, q) {
  const n = Math.min(a.length, b.length);
  const r = seeded(4242);
  const ratios = [];
  const sa = new Array(n);
  const sb = new Array(n);
  for (let k = 0; k < BOOTSTRAP; k += 1) {
    for (let i = 0; i < n; i += 1) {
      const idx = Math.floor(r() * n);
      sa[i] = a[idx];
      sb[i] = b[idx];
    }
    sa.sort((x, y) => x - y);
    sb.sort((x, y) => x - y);
    ratios.push(quantile(sa, q) / quantile(sb, q) - 1);
  }
  ratios.sort((x, y) => x - y);
  return { low: quantile(ratios, 0.025), high: quantile(ratios, 0.975) };
}

function compare(rls, plain) {
  const a = stats(rls);
  const b = stats(plain);
  const ci50 = bootstrapRatio(rls, plain, 0.5);
  const ci95 = bootstrapRatio(rls, plain, 0.95);
  const blockSize = Math.floor(rls.length / BLOCKS);
  const blocks = [];
  for (let i = 0; i < BLOCKS; i += 1) {
    const ra = stats(rls.slice(i * blockSize, (i + 1) * blockSize)).p50;
    const rb = stats(plain.slice(i * blockSize, (i + 1) * blockSize)).p50;
    blocks.push(ra / rb - 1);
  }
  return {
    rls: a,
    plain: b,
    overheadP50: a.p50 / b.p50 - 1,
    overheadP50Ci: ci50,
    overheadP95: a.p95 / b.p95 - 1,
    overheadP95Ci: ci95,
    deltaP50Ms: a.p50 - b.p50,
    blocks,
  };
}

async function client(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

function dbUrl(base, user, name) {
  const parsed = new URL(base);
  if (user) parsed.username = user;
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function adminExec(adminBase, sqlText) {
  const c = await client(dbUrl(adminBase, null, 'postgres'));
  try {
    await c.query(sqlText);
  } finally {
    await c.end();
  }
}

async function disableRls(adminBase, name) {
  const c = await client(dbUrl(adminBase, null, name));
  try {
    const { rows } = await c.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
    );
    for (const { relname } of rows)
      await c.query(`alter table "${relname}" no force row level security, disable row level security`);
    return rows.length;
  } finally {
    await c.end();
  }
}

async function addOrders(c, tenantFilter) {
  await c.query(
    `insert into orders (id, tenant_id, number, email, status, currency, subtotal_cents, total_cents, shipping_address, idempotency_key, placed_at)
     select gen_random_uuid(), t.id, 100000 + n, 'buyer' || n || '@bench.dev', (array['paid','fulfilled','pending_payment','cancelled'])[1 + n % 4],
       'USD', 1000 + (n % 97) * 100, 1000 + (n % 97) * 100, '{"city":"Berlin"}'::jsonb, 'bench-' || n, now() - n * interval '7 minutes'
     from tenants t cross join generate_series(1, $1::int) n where ${tenantFilter}`,
    [ORDERS_PER_TENANT],
  );
  await c.query(
    `insert into order_items (id, tenant_id, order_id, variant_id, product_id, title_snapshot, sku_snapshot, unit_price_cents, quantity)
     select gen_random_uuid(), o.tenant_id, o.id, v.id, v.product_id, 'Item', v.sku, v.price_cents, 1
     from orders o join tenants t on t.id = o.tenant_id
     cross join lateral (select id, product_id, sku, price_cents from product_variants pv where pv.tenant_id = o.tenant_id
       order by pv.id offset (o.number % 40) limit 2) v
     where o.idempotency_key like 'bench-%' and ${tenantFilter.replaceAll('t.', 't.')}`,
  );
}

async function cloneTenants(c, sourceTenant) {
  await c.query(
    'create temp table tmap as select gen_random_uuid() as tid, n from generate_series(1, $1::int) n',
    [CLONES],
  );
  await c.query(
    `insert into tenants (id, slug, name, settings) select tid, 'bench-' || n, 'Bench ' || n, s.settings
       from tmap, (select settings from tenants where id = $1) s`,
    [sourceTenant],
  );
  await c.query(
    `create temp table cmap as select c.id as old_id, gen_random_uuid() as new_id, t.tid from categories c cross join tmap t where c.tenant_id = $1`,
    [sourceTenant],
  );
  await c.query(
    `insert into categories (id, tenant_id, parent_id, name, slug, path)
     select m.new_id, m.tid, pm.new_id, c.name, c.slug, c.path from cmap m join categories c on c.id = m.old_id
     left join cmap pm on pm.old_id = c.parent_id and pm.tid = m.tid`,
  );
  await c.query(
    `create temp table pmap as select p.id as old_id, gen_random_uuid() as new_id, t.tid from products p cross join tmap t where p.tenant_id = $1`,
    [sourceTenant],
  );
  await c.query(
    `insert into products (id, tenant_id, category_id, title, slug, description, brand, status, attributes, tags, price_min_cents, created_at, updated_at)
     select m.new_id, m.tid, cm.new_id, p.title, p.slug, p.description, p.brand, p.status, p.attributes, p.tags, p.price_min_cents, p.created_at, p.updated_at
     from pmap m join products p on p.id = m.old_id left join cmap cm on cm.old_id = p.category_id and cm.tid = m.tid`,
  );
  await c.query(
    `create temp table vmap as select v.id as old_id, gen_random_uuid() as new_id, m.new_id as product_id, m.tid
       from product_variants v join pmap m on m.old_id = v.product_id`,
  );
  await c.query(
    `insert into product_variants (id, tenant_id, product_id, sku, title, price_cents, compare_at_cents, currency, attributes)
     select m.new_id, m.tid, m.product_id, v.sku, v.title, v.price_cents, v.compare_at_cents, v.currency, v.attributes
     from vmap m join product_variants v on v.id = m.old_id`,
  );
  await c.query(
    `insert into inventory_items (variant_id, tenant_id, on_hand, reserved)
     select m.new_id, m.tid, i.on_hand, 0 from vmap m join inventory_items i on i.variant_id = m.old_id`,
  );
}

async function deleteOtherTenants(c, keepTenant) {
  await c.query('set session_replication_role = replica');
  const { rows } = await c.query(
    `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'`,
  );
  for (const { table_name: table } of rows)
    await c.query(`delete from "${table}" where tenant_id <> $1`, [keepTenant]);
  await c.query('delete from tenants where id <> $1', [keepTenant]);
  await c.query('set session_replication_role = origin');
}

async function counts(c) {
  const { rows } = await c.query(`select
      (select count(*)::int from tenants) as tenants,
      (select count(*)::int from products) as products,
      (select count(*)::int from product_variants) as variants,
      (select count(*)::int from orders) as orders,
      (select count(*)::int from order_items) as order_items`);
  return rows[0];
}

const productSelect = (where) => `
  select p.id, p.title, p.slug, p.description, p.brand, p.status, p.category_id, c.path::text as category_path,
    c.name as category_name, p.attributes, p.tags, p.price_min_cents, p.created_at, p.updated_at
  from products p left join categories c on c.id = p.category_id
  where ${where} limit 1`;

const listSelect = (where, order, rank = '0') => `
  select p.id, p.title, p.slug, p.brand, p.price_min_cents, p.created_at, c.path::text as category_path,
    ${rank} as rank,
    (select max(v.compare_at_cents) from product_variants v where v.product_id = p.id) as compare_at_cents,
    (select min(v.currency) from product_variants v where v.product_id = p.id) as currency,
    (select pi.storage_key from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_key,
    coalesce((select bool_or(i.on_hand - i.reserved > 0) from product_variants v join inventory_items i on i.variant_id = v.id where v.product_id = p.id), false) as available
  from products p left join categories c on c.id = p.category_id
  where ${where}
  order by ${order}
  limit 24`;

const searchCond = `(p.search_tsv @@ websearch_to_tsquery('simple', $1) or p.title % $1 or p.title ilike $2 or p.brand ilike $2)`;
const searchRank = `(ts_rank(p.search_tsv, websearch_to_tsquery('simple', $1)) + similarity(p.title, $1))`;

function sqlQueries(fixtures) {
  const t = (n) => `$${n}::uuid`;
  return [
    {
      name: 'category by slug',
      params: () => [pick(fixtures.categorySlugs)],
      rls: [`select id, parent_id, name, slug, path::text as path from categories where slug = $1 limit 1`],
      plain: [
        `select id, parent_id, name, slug, path::text as path from categories where tenant_id = ${t(2)} and slug = $1 limit 1`,
      ],
    },
    {
      name: 'product by slug (PDP)',
      params: () => [pick(fixtures.productSlugs)],
      rls: [productSelect(`p.slug = $1 and p.status = 'active'`)],
      plain: [productSelect(`p.tenant_id = ${t(2)} and p.slug = $1 and p.status = 'active'`)],
    },
    {
      name: 'variants + stock of a product',
      params: () => [pick(fixtures.productIds)],
      rls: [
        `select v.id, v.product_id, v.sku, v.title, v.price_cents, v.compare_at_cents, v.currency, v.attributes,
           coalesce(i.on_hand, 0) as on_hand, coalesce(i.reserved, 0) as reserved
         from product_variants v left join inventory_items i on i.variant_id = v.id
         where v.product_id in ($1::uuid) order by v.price_cents, v.sku`,
      ],
      plain: [
        `select v.id, v.product_id, v.sku, v.title, v.price_cents, v.compare_at_cents, v.currency, v.attributes,
           coalesce(i.on_hand, 0) as on_hand, coalesce(i.reserved, 0) as reserved
         from product_variants v left join inventory_items i on i.variant_id = v.id
         where v.tenant_id = ${t(2)} and v.product_id in ($1::uuid) order by v.price_cents, v.sku`,
      ],
    },
    {
      name: 'storefront list, newest 24',
      params: () => [],
      rls: [listSelect(`p.status = 'active'`, 'p.created_at desc, p.id desc')],
      plain: [listSelect(`p.tenant_id = ${t(1)} and p.status = 'active'`, 'p.created_at desc, p.id desc')],
    },
    {
      name: 'category page, price asc',
      params: () => [pick(fixtures.categoryPaths)],
      rls: [
        listSelect(
          `p.status = 'active' and c.path <@ $1::ltree`,
          'coalesce(p.price_min_cents, 0) asc, p.id asc',
        ),
      ],
      plain: [
        listSelect(
          `p.tenant_id = ${t(2)} and p.status = 'active' and c.path <@ $1::ltree`,
          'coalesce(p.price_min_cents, 0) asc, p.id asc',
        ),
      ],
    },
    {
      name: 'full-text search page',
      params: () => {
        const q = pick(fixtures.searchTerms);
        return [q, `%${q}%`];
      },
      rls: [listSelect(`p.status = 'active' and ${searchCond}`, `${searchRank} desc, p.id`, searchRank)],
      plain: [
        listSelect(
          `p.tenant_id = ${t(3)} and p.status = 'active' and ${searchCond}`,
          `${searchRank} desc, p.id`,
          searchRank,
        ),
      ],
    },
    {
      name: 'search suggest (trigram)',
      params: () => {
        const q = pick(fixtures.searchTerms);
        return [q, `%${q}%`, `${q}%`];
      },
      rls: [
        `select p.id, p.title, p.slug, greatest(word_similarity($1, p.title), similarity(p.title, $1)) as score
         from products p where p.status = 'active' and (p.title ilike $2 or word_similarity($1, p.title) > 0.3 or p.title % $1)
         order by (p.title ilike $3) desc, score desc, p.title limit 8`,
      ],
      plain: [
        `select p.id, p.title, p.slug, greatest(word_similarity($1, p.title), similarity(p.title, $1)) as score
         from products p where p.tenant_id = ${t(4)} and p.status = 'active' and (p.title ilike $2 or word_similarity($1, p.title) > 0.3 or p.title % $1)
         order by (p.title ilike $3) desc, score desc, p.title limit 8`,
      ],
    },
    {
      name: 'admin orders, newest 50',
      params: () => [],
      rls: [`select * from orders order by placed_at desc, id desc limit 50`],
      plain: [`select * from orders where tenant_id = ${t(1)} order by placed_at desc, id desc limit 50`],
    },
    {
      name: 'order detail (order + items)',
      params: () => [pick(fixtures.orderIds)],
      rls: [`select * from orders where id = $1 limit 1`, `select * from order_items where order_id = $1`],
      plain: [
        `select * from orders where tenant_id = ${t(2)} and id = $1 limit 1`,
        `select * from order_items where tenant_id = ${t(2)} and order_id = $1`,
      ],
    },
    {
      name: 'reserve stock (UPDATE, rolled back)',
      write: true,
      params: () => [pick(fixtures.variantIds)],
      rls: [
        `update inventory_items set reserved = reserved + 1 where variant_id = $1 and on_hand - reserved >= 1 returning variant_id`,
      ],
      plain: [
        `update inventory_items set reserved = reserved + 1 where tenant_id = ${t(2)} and variant_id = $1 and on_hand - reserved >= 1 returning variant_id`,
      ],
    },
  ];
}

async function runTx(c, statements, params, { tenantId, setContext, explicitTenant, write }) {
  const started = performance.now();
  await c.query('begin');
  if (setContext) await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  const queryStart = performance.now();
  let rows = 0;
  for (const text of statements) {
    const values = explicitTenant ? [...params, tenantId] : params;
    const result = await c.query(text, values);
    rows += result.rowCount ?? 0;
  }
  const queryMs = performance.now() - queryStart;
  await c.query(write ? 'rollback' : 'commit');
  return { totalMs: performance.now() - started, queryMs, rows };
}

async function planOf(c, text, params, opts) {
  await c.query('begin');
  try {
    if (opts.setContext) await c.query("select set_config('app.tenant_id', $1, true)", [opts.tenantId]);
    const values = opts.explicitTenant ? [...params, opts.tenantId] : params;
    const { rows } = await c.query(`explain (costs off) ${text}`, values);
    return rows.map((r) => r['QUERY PLAN']);
  } finally {
    await c.query('rollback');
  }
}

async function sqlBench(urls, tenantId, fixtures) {
  const variants = {
    rls: { client: await client(urls.rls), setContext: true, explicitTenant: false },
    rlsExplicit: { client: await client(urls.rls), setContext: true, explicitTenant: true },
    plain: { client: await client(urls.plain), setContext: false, explicitTenant: true },
  };
  const results = [];
  try {
    for (const query of sqlQueries(fixtures)) {
      const samples = { rls: [], rlsExplicit: [], plain: [] };
      const querySamples = { rls: [], rlsExplicit: [], plain: [] };
      const rowCounts = { rls: 0, rlsExplicit: 0, plain: 0 };
      for (let i = 0; i < SQL_WARMUP + SQL_ITERATIONS; i += 1) {
        const params = query.params();
        for (const key of shuffle(Object.keys(variants))) {
          const v = variants[key];
          const statements = key === 'rls' ? query.rls : query.plain;
          const r = await runTx(v.client, statements, params, {
            tenantId,
            setContext: v.setContext,
            explicitTenant: v.explicitTenant,
            write: query.write,
          });
          if (i >= SQL_WARMUP) {
            samples[key].push(r.totalMs);
            querySamples[key].push(r.queryMs);
            rowCounts[key] += r.rows;
          }
        }
      }
      const planParams = query.params();
      const plans = {
        rls: await planOf(variants.rls.client, query.rls[0], planParams, { ...variants.rls, tenantId }),
        plain: await planOf(variants.plain.client, query.plain[0], planParams, {
          ...variants.plain,
          tenantId,
        }),
      };
      const entry = {
        name: query.name,
        rowsMatch: rowCounts.rls === rowCounts.plain && rowCounts.rls === rowCounts.rlsExplicit,
        rows: rowCounts,
        transaction: compare(samples.rls, samples.plain),
        transactionRlsExplicit: compare(samples.rlsExplicit, samples.plain),
        queryOnly: compare(querySamples.rls, querySamples.plain),
        plans,
      };
      results.push(entry);
      log(
        `sql ${query.name}: p50 ${entry.transaction.rls.p50.toFixed(3)} vs ${entry.transaction.plain.p50.toFixed(3)} ms (${(entry.transaction.overheadP50 * 100).toFixed(1)}% [${(entry.transaction.overheadP50Ci.low * 100).toFixed(1)}, ${(entry.transaction.overheadP50Ci.high * 100).toFixed(1)}]), rows match: ${entry.rowsMatch}`,
      );
    }
  } finally {
    for (const v of Object.values(variants)) await v.client.end();
  }
  return results;
}

async function fixturesFor(url, tenantId) {
  const c = await client(url);
  try {
    const one = async (text) => (await c.query(text, [tenantId])).rows;
    return {
      categorySlugs: (await one('select slug from categories where tenant_id = $1')).map((r) => r.slug),
      categoryPaths: (
        await one('select path::text as path from categories where tenant_id = $1 and parent_id is null')
      ).map((r) => r.path),
      productSlugs: (await one(`select slug from products where tenant_id = $1 and status = 'active'`)).map(
        (r) => r.slug,
      ),
      productIds: (await one(`select id from products where tenant_id = $1 and status = 'active'`)).map(
        (r) => r.id,
      ),
      variantIds: (
        await one(
          `select i.variant_id from inventory_items i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id where i.tenant_id = $1 and i.on_hand > 0 and p.status = 'active'`,
        )
      ).map((r) => r.variant_id),
      orderIds: (await one('select id from orders where tenant_id = $1')).map((r) => r.id),
      searchTerms: ['trail', 'running shoe', 'jacket', 'sock', 'waterproof', 'lightweight', 'bottle', 'cap'],
    };
  } finally {
    await c.end();
  }
}

function spawnApi(stack, port, database, prefix, logDir) {
  const adminBase = stack.env.DATABASE_ADMIN_URL;
  const out = openSync(join(logDir, `api-${port}.log`), 'a');
  const env = {
    ...process.env,
    ...stack.env,
    API_PORT: String(port),
    INTERNAL_API_URL: `http://127.0.0.1:${port}`,
    DATABASE_URL: dbUrl(adminBase, 'app_user', database),
    DATABASE_SYSTEM_URL: dbUrl(adminBase, 'app_system', database),
    DATABASE_ADMIN_URL: dbUrl(adminBase, null, database),
    REDIS_PREFIX: prefix,
    CONSUMERS_ENABLED: 'false',
    JOBS_ENABLED: 'false',
    LOG_LEVEL: 'warn',
    STOREFRONT_RATE_LIMIT_PER_MIN: '10000000',
    RECO_CACHE_SECONDS: '0',
    ANALYTICS_CACHE_SECONDS: '0',
    DECISION_CACHE_MS: '0',
    FAKE_PAYMENT_POLL_MS: '0',
  };
  delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return spawn('node', ['apps/api/dist/main.js'], { cwd: root, env, stdio: ['ignore', out, out] });
}

async function timedFetch(url, init) {
  const started = performance.now();
  const response = await fetch(url, init);
  const body = await response.text();
  return { ms: performance.now() - started, status: response.status, bytes: body.length, body };
}

async function login(base) {
  const r = await timedFetch(`${base}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@runhub.dev', password: 'demo1234' }),
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`login failed on ${base}: ${r.status} ${r.body}`);
  const body = JSON.parse(r.body);
  const tenantId =
    body.memberships.find((m) => m.tenantSlug === 'runhub' || m.slug === 'runhub')?.tenantId ??
    body.memberships[0].tenantId;
  return { authorization: `Bearer ${body.accessToken}`, 'x-tenant-id': tenantId };
}

async function httpBench(bases, fixtures) {
  const auth = { rls: await login(bases.rls), plain: await login(bases.plain) };
  const store = { 'x-store': 'runhub' };
  const endpoints = [
    {
      name: 'GET catalog/products (newest)',
      req: () => ({ path: '/v1/storefront/catalog/products?limit=24' }),
    },
    {
      name: 'GET catalog/products?category&sort=price_asc',
      req: () => ({
        path: `/v1/storefront/catalog/products?limit=24&sort=price_asc&category=${pick(fixtures.topCategorySlugs)}`,
      }),
    },
    {
      name: 'GET catalog/products/:slug (PDP)',
      req: () => ({ path: `/v1/storefront/catalog/products/${pick(fixtures.productSlugs)}` }),
    },
    {
      name: 'GET search/suggest',
      req: () => ({
        path: `/v1/storefront/search/suggest?q=${encodeURIComponent(pick(fixtures.searchTerms))}`,
      }),
    },
    {
      name: 'POST cart/items (new cart)',
      req: () => ({
        path: '/v1/storefront/cart/items',
        method: 'POST',
        body: { variantId: pick(fixtures.variantIds), quantity: 1 },
        headers: { 'x-anonymous-id': randomUUID() },
      }),
    },
    { name: 'GET admin/orders (50)', admin: true, req: () => ({ path: '/v1/admin/orders?limit=50' }) },
    {
      name: 'GET admin/orders/:id',
      admin: true,
      req: () => ({ path: `/v1/admin/orders/${pick(fixtures.orderIds)}` }),
    },
    { name: 'GET admin/products (50)', admin: true, req: () => ({ path: '/v1/admin/products?limit=50' }) },
  ];
  const results = [];
  for (const endpoint of endpoints) {
    const samples = { rls: [], plain: [] };
    const statuses = { rls: {}, plain: {} };
    const bytes = { rls: 0, plain: 0 };
    for (let i = 0; i < HTTP_WARMUP + HTTP_ITERATIONS; i += 1) {
      const spec = endpoint.req();
      for (const key of shuffle(['rls', 'plain'])) {
        const headers = {
          ...(endpoint.admin ? auth[key] : store),
          ...(spec.body ? { 'content-type': 'application/json' } : {}),
          ...(spec.headers ?? {}),
        };
        const r = await timedFetch(`${bases[key]}${spec.path}`, {
          method: spec.method ?? 'GET',
          headers,
          body: spec.body ? JSON.stringify(spec.body) : undefined,
        });
        if (i >= HTTP_WARMUP) {
          samples[key].push(r.ms);
          statuses[key][r.status] = (statuses[key][r.status] ?? 0) + 1;
          bytes[key] += r.bytes;
        }
      }
    }
    const entry = {
      name: endpoint.name,
      statuses,
      bytesEqual: bytes.rls === bytes.plain,
      latency: compare(samples.rls, samples.plain),
    };
    results.push(entry);
    log(
      `http ${endpoint.name}: p50 ${entry.latency.rls.p50.toFixed(2)} vs ${entry.latency.plain.p50.toFixed(2)} ms (${(entry.latency.overheadP50 * 100).toFixed(1)}% [${(entry.latency.overheadP50Ci.low * 100).toFixed(1)}, ${(entry.latency.overheadP50Ci.high * 100).toFixed(1)}]) statuses ${JSON.stringify(statuses)}`,
    );
  }
  return results;
}

const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const ci = (c) => `[${pct(c.low)}, ${pct(c.high)}]`;
const ms = (v) => v.toFixed(3);

function markdown(report) {
  const lines = [];
  lines.push(`# RLS overhead benchmark${LABEL ? ` — ${LABEL}` : ''}`, '');
  lines.push(
    `Generated by \`node scripts/rls-bench.mjs\` on ${report.date}. ${report.environment.cpu} (${report.environment.cores} cores, ${report.environment.memoryGb} GB), ${report.environment.postgres}, Node ${report.environment.node}. Load average before ${report.environment.loadBefore.map((v) => v.toFixed(2)).join(' / ')}, after ${report.environment.loadAfter.map((v) => v.toFixed(2)).join(' / ')}.`,
    '',
  );
  lines.push(
    'Method: two databases with identical data, the second created with `CREATE DATABASE … TEMPLATE` from the first, then RLS disabled on every table. **RLS**: role `app_user`, FORCE RLS, `BEGIN; set_config(app.tenant_id); <query as the app writes it, no tenant predicate>; COMMIT`. **No RLS**: same role on the copy, `BEGIN; <same query + explicit tenant_id = $tenant>; COMMIT` — what the code would have to do without RLS. **RLS + explicit**: the RLS database with the explicit predicate added as well. Every iteration runs all variants in a random order on dedicated connections (interleaved, so machine noise hits all variants alike), after a warm-up. Overhead = p50(RLS) / p50(no RLS) − 1 with a 95% bootstrap confidence interval (resampling iterations, ' +
      `${BOOTSTRAP} resamples); "blocks" is the p50 overhead in ${BLOCKS} consecutive quarters of the run as a stability check. Writes are rolled back.`,
    '',
  );
  lines.push(
    `## SQL level — ${report.sql.dataset.tenants} tenants, ${report.sql.dataset.products.toLocaleString('en-US')} products, ${report.sql.dataset.variants.toLocaleString('en-US')} variants, ${report.sql.dataset.orders.toLocaleString('en-US')} orders, ${report.sql.dataset.order_items.toLocaleString('en-US')} order items; ${SQL_ITERATIONS} iterations per query`,
    '',
  );
  lines.push(
    '| Query | No RLS p50 / p95 (ms) | RLS p50 / p95 (ms) | RLS overhead p50 (95% CI) | p95 overhead (95% CI) | RLS + explicit p50 overhead | Blocks (p50) | Same rows |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const r of report.sql.results) {
    const t = r.transaction;
    lines.push(
      `| ${r.name} | ${ms(t.plain.p50)} / ${ms(t.plain.p95)} | ${ms(t.rls.p50)} / ${ms(t.rls.p95)} | ${pct(t.overheadP50)} ${ci(t.overheadP50Ci)} | ${pct(t.overheadP95)} ${ci(t.overheadP95Ci)} | ${pct(r.transactionRlsExplicit.overheadP50)} ${ci(r.transactionRlsExplicit.overheadP50Ci)} | ${t.blocks.map(pct).join(' ')} | ${r.rowsMatch ? 'yes' : 'NO'} |`,
    );
  }
  lines.push('', 'Statement time only (without BEGIN / set_config / COMMIT round trips):', '');
  lines.push('| Query | No RLS p50 (ms) | RLS p50 (ms) | Overhead p50 (95% CI) |', '|---|---|---|---|');
  for (const r of report.sql.results) {
    const q = r.queryOnly;
    lines.push(
      `| ${r.name} | ${ms(q.plain.p50)} | ${ms(q.rls.p50)} | ${pct(q.overheadP50)} ${ci(q.overheadP50Ci)} |`,
    );
  }
  if (report.http) {
    lines.push(
      '',
      `## HTTP level — API production build against each database, single-tenant copies (${report.http.dataset.products} products, ${report.http.dataset.orders} orders), ${HTTP_ITERATIONS} requests per endpoint and variant`,
      '',
      'The repositories rely on RLS for tenant filtering, so the API cannot run against a non-RLS database that holds other tenants without leaking them; for this comparison both copies contain only the RunHub tenant, which isolates the cost of the RLS machinery (`set_config` per transaction and the policy predicates) on the request path.',
      '',
      '| Endpoint | No RLS p50 / p95 (ms) | RLS p50 / p95 (ms) | Overhead p50 (95% CI) | Overhead p95 (95% CI) | Blocks (p50) | Statuses (RLS / no RLS) |',
      '|---|---|---|---|---|---|---|',
    );
    for (const r of report.http.results) {
      const l = r.latency;
      lines.push(
        `| ${r.name} | ${l.plain.p50.toFixed(2)} / ${l.plain.p95.toFixed(2)} | ${l.rls.p50.toFixed(2)} / ${l.rls.p95.toFixed(2)} | ${pct(l.overheadP50)} ${ci(l.overheadP50Ci)} | ${pct(l.overheadP95)} ${ci(l.overheadP95Ci)} | ${l.blocks.map(pct).join(' ')} | ${JSON.stringify(r.statuses.rls)} / ${JSON.stringify(r.statuses.plain)} |`,
      );
    }
  }
  lines.push('', '## Plans (RLS vs no RLS, first statement, `EXPLAIN (COSTS OFF)`)', '');
  for (const r of report.sql.results) {
    lines.push(
      `### ${r.name}`,
      '',
      'RLS:',
      '',
      '```text',
      ...r.plans.rls,
      '```',
      '',
      'No RLS:',
      '',
      '```text',
      ...r.plans.plain,
      '```',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const loadBefore = loadavg();
  const id = `rlsbench${Date.now().toString(36)}`;
  const stack = stackEnv('smoke', id);
  const adminBase = stack.env.DATABASE_ADMIN_URL;
  const names = {
    base: stack.name,
    plain: `${stack.name}_norls`,
    httpRls: `${stack.name}_h1`,
    httpPlain: `${stack.name}_h0`,
  };
  const logDir = join(root, '.smoke', id);
  mkdirSync(logDir, { recursive: true });
  const children = [];
  const dropExtra = async () => {
    for (const name of [names.plain, names.httpRls, names.httpPlain])
      await adminExec(adminBase, `drop database if exists "${name}" with (force)`).catch(() => undefined);
  };
  let failed = false;
  const report = { date: new Date().toISOString() };
  try {
    log(`provisioning ${names.base} (seed)`);
    await provision(stack);
    const runhubTenant = await (async () => {
      const c = await client(dbUrl(adminBase, null, names.base));
      try {
        await addOrders(c, 'true');
        return (await c.query(`select id from tenants where slug = 'runhub'`)).rows[0].id;
      } finally {
        await c.end();
      }
    })();

    if (!SKIP_HTTP) {
      log('building single-tenant copies for the HTTP comparison');
      await adminExec(adminBase, `create database "${names.httpRls}" template "${names.base}"`);
      const h = await client(dbUrl(adminBase, null, names.httpRls));
      try {
        await deleteOtherTenants(h, runhubTenant);
      } finally {
        await h.end();
      }
      const hv = await client(dbUrl(adminBase, null, names.httpRls));
      await hv.query('vacuum full analyze');
      await hv.end();
      await adminExec(adminBase, `create database "${names.httpPlain}" template "${names.httpRls}"`);
      await disableRls(adminBase, names.httpPlain);
    }

    log(`cloning the RunHub catalog into ${CLONES} more tenants`);
    const c = await client(dbUrl(adminBase, null, names.base));
    try {
      await cloneTenants(c, runhubTenant);
      await addOrders(c, `t.slug like 'bench-%'`);
      await c.query('vacuum analyze');
      report.sqlDataset = await counts(c);
    } finally {
      await c.end();
    }
    await adminExec(adminBase, `create database "${names.plain}" template "${names.base}"`);
    const disabled = await disableRls(adminBase, names.plain);
    const pv = await client(dbUrl(adminBase, null, names.plain));
    await pv.query('vacuum analyze');
    await pv.end();
    log(`RLS disabled on ${disabled} tables in ${names.plain}`);

    const pgVersion = await (async () => {
      const v = await client(dbUrl(adminBase, null, names.base));
      try {
        return (await v.query('select version()')).rows[0].version.split(',')[0];
      } finally {
        await v.end();
      }
    })();

    const fixtures = await fixturesFor(dbUrl(adminBase, null, names.base), runhubTenant);
    log(`SQL benchmark: ${SQL_ITERATIONS} iterations per query after ${SQL_WARMUP} warm-up`);
    const sqlResults = await sqlBench(
      { rls: dbUrl(adminBase, 'app_user', names.base), plain: dbUrl(adminBase, 'app_user', names.plain) },
      runhubTenant,
      fixtures,
    );
    report.sql = { dataset: report.sqlDataset, results: sqlResults };

    if (!SKIP_HTTP) {
      const httpFixtures = await fixturesFor(dbUrl(adminBase, null, names.httpRls), runhubTenant);
      const hc = await client(dbUrl(adminBase, null, names.httpRls));
      httpFixtures.topCategorySlugs = (
        await hc.query('select slug from categories where tenant_id = $1 and parent_id is null', [
          runhubTenant,
        ])
      ).rows.map((r) => r.slug);
      const httpDataset = await counts(hc);
      await hc.end();
      log('starting two API processes');
      children.push(spawnApi(stack, PORT_RLS, names.httpRls, `${stack.env.REDIS_PREFIX}a:`, logDir));
      children.push(spawnApi(stack, PORT_PLAIN, names.httpPlain, `${stack.env.REDIS_PREFIX}b:`, logDir));
      await waitHealthy(`http://127.0.0.1:${PORT_RLS}/health/ready`);
      await waitHealthy(`http://127.0.0.1:${PORT_PLAIN}/health/ready`);
      log(`HTTP benchmark: ${HTTP_ITERATIONS} requests per endpoint and variant`);
      const httpResults = await httpBench(
        { rls: `http://127.0.0.1:${PORT_RLS}`, plain: `http://127.0.0.1:${PORT_PLAIN}` },
        httpFixtures,
      );
      report.http = { dataset: httpDataset, results: httpResults };
    }
    report.environment = {
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 1024 ** 3),
      node: process.version,
      postgres: pgVersion,
      loadBefore,
      loadAfter: loadavg(),
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${NAME}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(OUT, `${NAME}.md`), markdown(report));
    log(`wrote ${join(OUT, `${NAME}.md`)} and ${NAME}.json`);
  } catch (error) {
    failed = true;
    process.stderr.write(`rls-bench: ${error instanceof Error ? error.stack : String(error)}\n`);
  } finally {
    for (const child of children) child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 2000));
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    await dropExtra();
    await teardown(stack);
  }
  process.exit(failed ? 1 : 0);
}

await main();
