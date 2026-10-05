import type { FeedItem } from '@cip/contracts';
import type { Period } from '../domain/analytics';

export const ANALYTICS_STORE = Symbol('ANALYTICS_STORE');
export const LIVE_METRICS = Symbol('LIVE_METRICS');
export const ANALYTICS_CACHE = Symbol('ANALYTICS_CACHE');
export const PRODUCT_TITLES = Symbol('PRODUCT_TITLES');

export interface OverviewNumbers {
  revenueCents: number;
  paidOrders: number;
  placedOrders: number;
  visitors: number;
}

export interface AnalyticsStore {
  overview(tenantId: string, period: Period): Promise<OverviewNumbers>;
  timeseries(
    tenantId: string,
    metric: string,
    interval: 'hour' | 'day',
    period: Period,
  ): Promise<Array<{ t: string; value: number }>>;
  funnel(
    tenantId: string,
    period: Period,
    windowSeconds: number,
  ): Promise<Array<{ level: number; users: number }>>;
  topProducts(
    tenantId: string,
    period: Period,
    by: string,
    limit: number,
  ): Promise<
    Array<{ productId: string; views: number; addToCart: number; purchases: number; revenueCents: number }>
  >;
  campaignPerformance(
    tenantId: string,
    period: Period,
  ): Promise<
    Array<{
      campaignId: string;
      creativeId: string;
      impressions: number;
      clicks: number;
      conversions: number;
    }>
  >;
  cohorts(tenantId: string, weeks: number): Promise<Array<{ cohort: string; week: number; users: number }>>;
  timeline(
    tenantId: string,
    profileIds: string[],
    customerId: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>>;
}

export interface LiveMetrics {
  snapshot(
    tenantId: string,
    seconds: number,
  ): Promise<{
    activeVisitors: number;
    revenueTodayCents: number;
    ordersToday: number;
    series: Array<{ ts: number; eventsPerSec: number }>;
    feed: FeedItem[];
  }>;
  issueTicket(payload: { tenantId: string; userId: string }, ttlSeconds: number): Promise<string>;
}

export interface AnalyticsCache {
  wrap<T>(tenantId: string, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T>;
}

export interface ProductTitles {
  titles(productIds: string[]): Promise<Map<string, string>>;
  creativeHeadlines(creativeIds: string[]): Promise<Map<string, string>>;
}
