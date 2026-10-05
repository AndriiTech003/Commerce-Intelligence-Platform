import { Inject, Injectable } from '@nestjs/common';
import { FUNNEL_STEPS } from '@cip/contracts';
import type { ApiConfig } from '../../../config';
import { stableStringify } from '../../../shared/crypto';
import { requireActor, requireTenant } from '../../../shared/http/actor';
import { CONFIG } from '../../../shared/tokens';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { cohortMatrix, funnelSteps, metric, previousPeriod, resolvePeriod } from '../domain/analytics';
import {
  ANALYTICS_CACHE,
  ANALYTICS_STORE,
  LIVE_METRICS,
  PRODUCT_TITLES,
  type AnalyticsCache,
  type AnalyticsStore,
  type LiveMetrics,
  type ProductTitles,
} from './ports';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_STORE) private readonly store: AnalyticsStore,
    @Inject(LIVE_METRICS) private readonly live: LiveMetrics,
    @Inject(ANALYTICS_CACHE) private readonly cache: AnalyticsCache,
    @Inject(PRODUCT_TITLES) private readonly products: ProductTitles,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private cached<T>(name: string, params: unknown, fn: () => Promise<T>): Promise<T> {
    const tenantId = requireTenant();
    return this.cache.wrap(
      tenantId,
      `${name}:${stableStringify(params)}`,
      this.config.ANALYTICS_CACHE_SECONDS,
      fn,
    );
  }

  overview(query: { from?: string | undefined; to?: string | undefined; compare: 'prev' | 'none' }) {
    const tenantId = requireTenant();
    const period = resolvePeriod(query.from, query.to);
    return this.cached('overview', { ...query, from: period.from, to: period.to }, async () => {
      const current = await this.store.overview(tenantId, period);
      const previous =
        query.compare === 'prev' ? await this.store.overview(tenantId, previousPeriod(period)) : null;
      const aov = (n: { revenueCents: number; paidOrders: number }) =>
        n.paidOrders > 0 ? Math.round(n.revenueCents / n.paidOrders) : 0;
      const conversion = (n: { placedOrders: number; visitors: number }) =>
        n.visitors > 0 ? Math.round((n.placedOrders / n.visitors) * 10000) / 100 : 0;
      return {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        revenueCents: metric(current.revenueCents, previous?.revenueCents ?? null),
        orders: metric(current.placedOrders, previous?.placedOrders ?? null),
        aovCents: metric(aov(current), previous ? aov(previous) : null),
        conversionRate: metric(conversion(current), previous ? conversion(previous) : null),
        visitors: metric(current.visitors, previous?.visitors ?? null),
      };
    });
  }

  timeseries(query: {
    from?: string | undefined;
    to?: string | undefined;
    metric: string;
    interval: 'hour' | 'day';
  }) {
    const tenantId = requireTenant();
    const period = resolvePeriod(query.from, query.to, query.interval === 'hour' ? 2 : 30);
    return this.cached('timeseries', { ...query, from: period.from, to: period.to }, async () => ({
      metric: query.metric,
      interval: query.interval,
      points: await this.store.timeseries(tenantId, query.metric, query.interval, period),
    }));
  }

  funnel(query: { from?: string | undefined; to?: string | undefined }, live = false) {
    const tenantId = requireTenant();
    const period = live ? resolvePeriod(undefined, undefined, 1 / 24) : resolvePeriod(query.from, query.to);
    const run = async () => ({
      steps: funnelSteps(await this.store.funnel(tenantId, period, 3600), FUNNEL_STEPS),
    });
    return live ? run() : this.cached('funnel', { from: period.from, to: period.to }, run);
  }

  topProducts(query: { from?: string | undefined; to?: string | undefined; by: string; limit: number }) {
    const tenantId = requireTenant();
    const period = resolvePeriod(query.from, query.to);
    return this.cached('top', { ...query, from: period.from, to: period.to }, async () => {
      const rows = await this.store.topProducts(tenantId, period, query.by, query.limit);
      const titles = await this.uow.run(() => this.products.titles(rows.map((r) => r.productId)));
      return { by: query.by, items: rows.map((r) => ({ ...r, title: titles.get(r.productId) ?? null })) };
    });
  }

  cohorts(query: { weeks: number; period: 'week' }) {
    const tenantId = requireTenant();
    return this.cached('cohorts', query, async () => ({
      period: query.period,
      cohorts: cohortMatrix(await this.store.cohorts(tenantId, query.weeks), query.weeks),
    }));
  }

  async liveSnapshot() {
    const tenantId = requireTenant();
    return { ts: Date.now(), ...(await this.live.snapshot(tenantId, 300)) };
  }

  async realtimeTicket() {
    const tenantId = requireTenant();
    const actor = requireActor();
    const ticket = await this.live.issueTicket({ tenantId, userId: actor.id! }, 30);
    return { ticket, url: this.config.REALTIME_PUBLIC_URL, expiresIn: 30 };
  }

  timeline(customerId: string, anonymousIds: string[]) {
    return this.store.timeline(requireTenant(), [customerId, ...anonymousIds], customerId, 50);
  }
}
