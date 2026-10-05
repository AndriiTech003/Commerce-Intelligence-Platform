import { z } from 'zod';
import { uuid } from '../events/envelope';

const isoDate = z.iso.datetime({ offset: true });

export const periodQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const overviewQuerySchema = periodQuerySchema.extend({
  compare: z.enum(['prev', 'none']).default('prev'),
});

export const metricValueSchema = z.object({
  value: z.number(),
  previous: z.number().nullable(),
  deltaPct: z.number().nullable(),
});

export const overviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  revenueCents: metricValueSchema,
  orders: metricValueSchema,
  aovCents: metricValueSchema,
  conversionRate: metricValueSchema,
  visitors: metricValueSchema,
});

export const TIMESERIES_METRICS = ['revenue', 'orders', 'events', 'visitors', 'product_views'] as const;

export const timeseriesQuerySchema = periodQuerySchema.extend({
  metric: z.enum(TIMESERIES_METRICS).default('revenue'),
  interval: z.enum(['hour', 'day']).default('day'),
});

export const timeseriesSchema = z.object({
  metric: z.string(),
  interval: z.string(),
  points: z.array(z.object({ t: z.string(), value: z.number() })),
});

export const FUNNEL_STEPS = [
  'product_viewed',
  'cart_item_added',
  'checkout_started',
  'order_placed',
] as const;

export const funnelSchema = z.object({
  steps: z.array(
    z.object({ step: z.string(), users: z.number().int(), conversionFromPrev: z.number().nullable() }),
  ),
});

export const topProductsQuerySchema = periodQuerySchema.extend({
  by: z.enum(['revenue', 'views', 'purchases', 'add_to_cart']).default('revenue'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const topProductsSchema = z.object({
  by: z.string(),
  items: z.array(
    z.object({
      productId: uuid,
      title: z.string().nullable(),
      views: z.number(),
      addToCart: z.number(),
      purchases: z.number(),
      revenueCents: z.number(),
    }),
  ),
});

export const cohortsQuerySchema = z.object({
  period: z.enum(['week']).default('week'),
  weeks: z.coerce.number().int().min(2).max(26).default(8),
});

export const cohortsSchema = z.object({
  period: z.string(),
  cohorts: z.array(z.object({ cohort: z.string(), size: z.number().int(), retention: z.array(z.number()) })),
});

export const feedItemSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  occurredAt: z.string(),
  country: z.string().nullable(),
  label: z.string(),
  productId: z.string().nullable(),
  revenueCents: z.number().nullable(),
});

export type FeedItem = z.infer<typeof feedItemSchema>;

export const liveTickSchema = z.object({
  type: z.literal('tick'),
  tenantId: z.string(),
  ts: z.number(),
  eventsPerSec: z.number(),
  byType: z.record(z.string(), z.number()),
  activeVisitors: z.number(),
  revenueTodayCents: z.number(),
  ordersToday: z.number(),
});

export type LiveTick = z.infer<typeof liveTickSchema>;

export const liveSnapshotSchema = z.object({
  ts: z.number(),
  activeVisitors: z.number(),
  revenueTodayCents: z.number(),
  ordersToday: z.number(),
  series: z.array(z.object({ ts: z.number(), eventsPerSec: z.number() })),
  feed: z.array(feedItemSchema),
});

export const liveFunnelSchema = funnelSchema;

export const dlqQueueSchema = z.object({
  queue: z.string(),
  source: z.string(),
  messages: z.number().int(),
});

export const dlqMessageSchema = z.object({
  messageId: z.string(),
  routingKey: z.string(),
  exchange: z.string(),
  headers: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  retryCount: z.number().int(),
  body: z.unknown(),
});

export const dlqReplaySchema = z.object({
  messageIds: z.union([z.array(z.string()).min(1).max(1000), z.literal('all')]),
});

export const dlqReplayResultSchema = z.object({ replayed: z.number().int(), remaining: z.number().int() });

export const tenantAdminSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string(),
  members: z.number().int(),
  products: z.number().int(),
  orders: z.number().int(),
});

export const ANALYTICS_EVENTS = {
  orderPlaced: 'order_placed',
  orderPaid: 'order_paid',
  orderRefunded: 'order_refunded',
  orderCancelled: 'order_cancelled',
  orderFulfilled: 'order_fulfilled',
  purchaseItem: 'purchase_item',
} as const;

export const REVENUE_EVENTS = [ANALYTICS_EVENTS.orderPaid, ANALYTICS_EVENTS.orderRefunded] as const;
