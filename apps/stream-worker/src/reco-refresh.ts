import type { ClickHouseClient } from '@clickhouse/client';
import type { RedisKeys } from '@cip/contracts';
import { categoryLevels } from '@cip/personalization';
import { counter, type Logger } from '@cip/observability';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

const refreshes = counter('reco_refresh_total', 'Popular list and price quantile refreshes', ['kind']);

const POPULAR_TTL = 3600;
const QUANTILE_TTL = 7200;

interface ProductStat {
  tenant_id: string;
  product_id: string;
  cat: string;
  views: string;
  adds: string;
  buys: string;
}

export class RecoRefresher {
  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly redis: Redis,
    private readonly keys: RedisKeys,
    private readonly logger: Logger,
  ) {}

  private async locked<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const key = this.keys.lock(name);
    const token = randomBytes(8).toString('hex');
    if ((await this.redis.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') return null;
    try {
      return await fn();
    } finally {
      const current = await this.redis.get(key);
      if (current === token) await this.redis.del(key);
    }
  }

  async refreshPopular(force = false): Promise<number> {
    const run = async () => {
      const result = await this.clickhouse.query({
        query: `SELECT toString(tenant_id) AS tenant_id, toString(assumeNotNull(product_id)) AS product_id,
            anyLast(category_path) AS cat,
            countIf(event_type = 'product_viewed') AS views,
            countIf(event_type = 'cart_item_added') AS adds,
            sumIf(coalesce(quantity, 0), event_type = 'purchase_item') AS buys
          FROM events
          WHERE occurred_at >= now() - INTERVAL 7 DAY AND product_id IS NOT NULL
          GROUP BY tenant_id, product_id`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<ProductStat>();
      const byTenant = new Map<string, ProductStat[]>();
      for (const row of rows) {
        const list = byTenant.get(row.tenant_id) ?? [];
        list.push(row);
        byTenant.set(row.tenant_id, list);
      }
      for (const [tenantId, stats] of byTenant) await this.writePopular(tenantId, stats);
      refreshes.inc({ kind: 'popular' });
      return byTenant.size;
    };
    return force ? run() : ((await this.locked('reco-popular', 120_000, run)) ?? 0);
  }

  private async writePopular(tenantId: string, stats: ProductStat[]): Promise<void> {
    const lists = new Map<string, Array<[number, string]>>();
    const views: Array<[number, string]> = [];
    for (const s of stats) {
      const score = Number(s.views) + 3 * Number(s.adds) + 5 * Number(s.buys);
      views.push([Number(s.views), s.product_id]);
      const buckets = ['_all', ...(s.cat ? categoryLevels(s.cat) : [])];
      for (const bucket of buckets) {
        const list = lists.get(bucket) ?? [];
        list.push([score, s.product_id]);
        lists.set(bucket, list);
      }
    }
    const pipeline = this.redis.pipeline();
    for (const [bucket, list] of lists) {
      const top = list.sort((a, b) => b[0] - a[0]).slice(0, 60);
      const key = this.keys.recoPopular(tenantId, bucket);
      const tmp = `${key}:tmp`;
      pipeline.del(tmp);
      pipeline.zadd(tmp, ...top.flat());
      pipeline.rename(tmp, key);
      pipeline.expire(key, POPULAR_TTL);
    }
    const viewsKey = this.keys.recoViews(tenantId);
    pipeline.del(`${viewsKey}:tmp`);
    for (let i = 0; i < views.length; i += 500)
      pipeline.zadd(`${viewsKey}:tmp`, ...views.slice(i, i + 500).flat());
    pipeline.rename(`${viewsKey}:tmp`, viewsKey);
    pipeline.expire(viewsKey, POPULAR_TTL);
    await pipeline.exec();
  }

  async refreshQuantiles(force = false): Promise<number> {
    const run = async () => {
      const result = await this.clickhouse.query({
        query: `SELECT toString(tenant_id) AS tenant_id, top, quantiles(0.33, 0.66)(price_cents) AS q FROM (
            SELECT tenant_id, splitByChar('.', category_path)[1] AS top, assumeNotNull(price_cents) AS price_cents
            FROM events
            WHERE event_type = 'product_viewed' AND occurred_at >= now() - INTERVAL 30 DAY
              AND price_cents > 0 AND category_path != ''
          ) GROUP BY tenant_id, top WITH ROLLUP HAVING tenant_id != ''`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ tenant_id: string; top: string; q: number[] }>();
      const pipeline = this.redis.pipeline();
      const tenants = new Set<string>();
      for (const row of rows) {
        const field = row.top === '' ? '_all' : row.top;
        pipeline.hset(
          this.keys.priceQuantiles(row.tenant_id),
          field,
          `${Math.round(row.q[0] ?? 0)}:${Math.round(row.q[1] ?? 0)}`,
        );
        tenants.add(row.tenant_id);
      }
      for (const tenant of tenants) pipeline.expire(this.keys.priceQuantiles(tenant), QUANTILE_TTL);
      await pipeline.exec();
      refreshes.inc({ kind: 'quantiles' });
      return tenants.size;
    };
    return force ? run() : ((await this.locked('reco-quantiles', 120_000, run)) ?? 0);
  }

  start(popularIntervalMs: number, quantileIntervalMs: number): () => void {
    const safe = (fn: () => Promise<unknown>, label: string) => () => {
      void fn().catch((error: unknown) => this.logger.warn({ err: error }, `${label} refresh failed`));
    };
    const initial = setTimeout(() => {
      safe(() => this.refreshPopular(), 'popular')();
      safe(() => this.refreshQuantiles(), 'quantiles')();
    }, 5000);
    const a = setInterval(
      safe(() => this.refreshPopular(), 'popular'),
      popularIntervalMs,
    );
    const b = setInterval(
      safe(() => this.refreshQuantiles(), 'quantiles'),
      quantileIntervalMs,
    );
    return () => {
      clearTimeout(initial);
      clearInterval(a);
      clearInterval(b);
    };
  }
}
