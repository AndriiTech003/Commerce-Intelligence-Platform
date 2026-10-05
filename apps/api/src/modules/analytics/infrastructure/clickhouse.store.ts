import { Inject, Injectable } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { ANALYTICS_EVENTS } from '@cip/contracts';
import { CLICKHOUSE } from '../../../shared/tokens';
import { toClickHouseDateTime, type Period } from '../domain/analytics';
import type { AnalyticsStore, OverviewNumbers } from '../application/ports';

@Injectable()
export class ClickHouseAnalyticsStore implements AnalyticsStore {
  constructor(@Inject(CLICKHOUSE) private readonly ch: ClickHouseClient) {}

  private async rows<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
    const result = await this.ch.query({ query, query_params: params, format: 'JSONEachRow' });
    return result.json<T>();
  }

  private params(tenantId: string, period: Period) {
    return { tenant: tenantId, from: toClickHouseDateTime(period.from), to: toClickHouseDateTime(period.to) };
  }

  async campaignPerformance(tenantId: string, period: Period) {
    const rows = await this.rows<{
      campaign_id: string;
      creative_id: string;
      impressions: string;
      clicks: string;
      conversions: string;
    }>(
      `SELECT toString(campaign_id) AS campaign_id, toString(creative_id) AS creative_id,
         sum(impressions) AS impressions, sum(clicks) AS clicks, sum(conversions) AS conversions
       FROM campaign_stats_hourly
       WHERE tenant_id = {tenant:UUID} AND hour >= toStartOfHour({from:DateTime64(3, 'UTC')}) AND hour < {to:DateTime64(3, 'UTC')}
       GROUP BY campaign_id, creative_id ORDER BY impressions DESC LIMIT 50`,
      this.params(tenantId, period),
    );
    return rows.map((r) => ({
      campaignId: r.campaign_id,
      creativeId: r.creative_id,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      conversions: Number(r.conversions),
    }));
  }

  async overview(tenantId: string, period: Period): Promise<OverviewNumbers> {
    const [row] = await this.rows<{ revenue: string; paid: string; placed: string; visitors: string }>(
      `SELECT
         sumIf(coalesce(revenue_cents, 0), event_type IN ({paid:String}, {refunded:String})) AS revenue,
         countIf(event_type = {paid:String}) AS paid,
         countIf(event_type = {placed:String}) AS placed,
         uniqExactIf(profile_id, event_type NOT IN ({paid:String}, {refunded:String}, {placed:String}, {item:String}, 'order_cancelled', 'order_fulfilled')) AS visitors
       FROM events FINAL
       WHERE tenant_id = {tenant:UUID} AND occurred_at >= {from:DateTime64(3, 'UTC')} AND occurred_at < {to:DateTime64(3, 'UTC')}`,
      {
        ...this.params(tenantId, period),
        paid: ANALYTICS_EVENTS.orderPaid,
        refunded: ANALYTICS_EVENTS.orderRefunded,
        placed: ANALYTICS_EVENTS.orderPlaced,
        item: ANALYTICS_EVENTS.purchaseItem,
      },
    );
    return {
      revenueCents: Number(row?.revenue ?? 0),
      paidOrders: Number(row?.paid ?? 0),
      placedOrders: Number(row?.placed ?? 0),
      visitors: Number(row?.visitors ?? 0),
    };
  }

  async timeseries(tenantId: string, metric: string, interval: 'hour' | 'day', period: Period) {
    const bucket = interval === 'hour' ? 'toStartOfHour' : 'toStartOfDay';
    const step = interval === 'hour' ? 3600 : 86400;
    const fill = `ORDER BY t WITH FILL FROM ${bucket}(toDateTime({from:DateTime64(3, 'UTC')})) TO ${bucket}(toDateTime({to:DateTime64(3, 'UTC')})) + ${step} STEP ${step}`;
    let query: string;
    if (metric === 'events' || metric === 'visitors') {
      const value = metric === 'events' ? 'countMerge(events)' : 'uniqMerge(uniq_profiles)';
      query = `SELECT ${bucket}(minute) AS t, ${value} AS value FROM events_per_minute
        WHERE tenant_id = {tenant:UUID} AND minute >= toStartOfMinute(toDateTime({from:DateTime64(3, 'UTC')})) AND minute < toDateTime({to:DateTime64(3, 'UTC')})
        GROUP BY t ${fill}`;
    } else {
      const value =
        metric === 'revenue'
          ? `sumIf(coalesce(revenue_cents, 0), event_type IN ('${ANALYTICS_EVENTS.orderPaid}', '${ANALYTICS_EVENTS.orderRefunded}'))`
          : metric === 'orders'
            ? `countIf(event_type = '${ANALYTICS_EVENTS.orderPlaced}')`
            : `countIf(event_type = 'product_viewed')`;
      query = `SELECT ${bucket}(toDateTime(occurred_at)) AS t, ${value} AS value FROM events FINAL
        WHERE tenant_id = {tenant:UUID} AND occurred_at >= {from:DateTime64(3, 'UTC')} AND occurred_at < {to:DateTime64(3, 'UTC')}
        GROUP BY t ${fill}`;
    }
    const rows = await this.rows<{ t: string; value: string | number }>(query, this.params(tenantId, period));
    return rows.map((r) => ({ t: `${r.t.replace(' ', 'T')}Z`, value: Number(r.value) }));
  }

  async funnel(tenantId: string, period: Period, windowSeconds: number) {
    const rows = await this.rows<{ level: number; users: string }>(
      `SELECT level, count() AS users FROM (
         SELECT profile_id,
           windowFunnel(${Math.floor(windowSeconds)})(toDateTime(occurred_at),
             event_type = 'product_viewed', event_type = 'cart_item_added',
             event_type = 'checkout_started', event_type = '${ANALYTICS_EVENTS.orderPlaced}') AS level
         FROM events
         WHERE tenant_id = {tenant:UUID} AND occurred_at >= {from:DateTime64(3, 'UTC')} AND occurred_at < {to:DateTime64(3, 'UTC')}
           AND event_type IN ('product_viewed', 'cart_item_added', 'checkout_started', '${ANALYTICS_EVENTS.orderPlaced}')
         GROUP BY profile_id
       ) GROUP BY level ORDER BY level`,
      this.params(tenantId, period),
    );
    return rows.map((r) => ({ level: Number(r.level), users: Number(r.users) }));
  }

  async topProducts(tenantId: string, period: Period, by: string, limit: number) {
    const order =
      by === 'views'
        ? 'views'
        : by === 'purchases'
          ? 'purchases'
          : by === 'add_to_cart'
            ? 'add_to_cart'
            : 'revenue_cents';
    const rows = await this.rows<{
      product_id: string;
      views: string;
      add_to_cart: string;
      purchases: string;
      revenue_cents: string;
    }>(
      `SELECT product_id, sum(views) AS views, sum(add_to_cart) AS add_to_cart, sum(purchases) AS purchases, sum(revenue_cents) AS revenue_cents
       FROM product_stats_daily
       WHERE tenant_id = {tenant:UUID} AND day >= toDate({from:DateTime64(3, 'UTC')}) AND day <= toDate({to:DateTime64(3, 'UTC')})
       GROUP BY product_id ORDER BY ${order} DESC, product_id LIMIT {limit:UInt32}`,
      { ...this.params(tenantId, period), limit },
    );
    return rows.map((r) => ({
      productId: r.product_id,
      views: Number(r.views),
      addToCart: Number(r.add_to_cart),
      purchases: Number(r.purchases),
      revenueCents: Number(r.revenue_cents),
    }));
  }

  async cohorts(tenantId: string, weeks: number) {
    const rows = await this.rows<{ cohort: string; week: number; users: string }>(
      `WITH first AS (
         SELECT profile_id, toMonday(min(occurred_at)) AS cohort FROM events
         WHERE tenant_id = {tenant:UUID} AND occurred_at >= now() - toIntervalWeek({weeks:UInt32})
         GROUP BY profile_id
       )
       SELECT toString(f.cohort) AS cohort, dateDiff('week', f.cohort, toMonday(e.occurred_at)) AS week, uniqExact(e.profile_id) AS users
       FROM events AS e INNER JOIN first AS f ON e.profile_id = f.profile_id
       WHERE e.tenant_id = {tenant:UUID} AND e.occurred_at >= now() - toIntervalWeek({weeks:UInt32})
       GROUP BY cohort, week HAVING week >= 0 AND week < {weeks:UInt32} ORDER BY cohort, week`,
      { tenant: tenantId, weeks },
    );
    return rows.map((r) => ({ cohort: r.cohort, week: Number(r.week), users: Number(r.users) }));
  }

  async timeline(tenantId: string, profileIds: string[], customerId: string, limit: number) {
    return this.rows<Record<string, unknown>>(
      `SELECT toString(event_id) AS eventId, event_type AS eventType, toString(occurred_at) AS occurredAt,
         toString(product_id) AS productId, revenue_cents AS revenueCents, country, device, properties
       FROM events FINAL
       WHERE tenant_id = {tenant:UUID} AND (profile_id IN {profiles:Array(UUID)} OR customer_id = {customer:UUID})
       ORDER BY occurred_at DESC LIMIT {limit:UInt32}`,
      { tenant: tenantId, profiles: profileIds, customer: customerId, limit },
    );
  }
}
