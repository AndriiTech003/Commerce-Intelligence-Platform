import { z } from 'zod';
import { envelopeSchema, uuid, type EventEnvelope } from './envelope';

const cents = z.number().int().min(0);

export const trackPropertySchemas = {
  page_viewed: z
    .object({ page_type: z.enum(['home', 'category', 'product', 'cart', 'checkout', 'other']) })
    .passthrough(),
  product_viewed: z
    .object({
      product_id: uuid,
      variant_id: uuid.optional(),
      category_path: z.string().max(256),
      price_cents: cents,
      brand: z.string().max(128).optional(),
    })
    .passthrough(),
  product_list_viewed: z
    .object({
      list_id: z.string().max(128),
      category_path: z.string().max(256).optional(),
      product_ids: z.array(uuid).max(100),
    })
    .passthrough(),
  search_performed: z
    .object({ query: z.string().max(256), results_count: z.number().int().min(0) })
    .passthrough(),
  cart_item_added: z
    .object({
      product_id: uuid,
      variant_id: uuid,
      quantity: z.number().int().min(1),
      price_cents: cents,
      category_path: z.string().max(256),
    })
    .passthrough(),
  cart_item_removed: z
    .object({ product_id: uuid, variant_id: uuid, quantity: z.number().int().min(1) })
    .passthrough(),
  checkout_started: z
    .object({ cart_id: uuid, value_cents: cents, items_count: z.number().int().min(0) })
    .passthrough(),
  ad_impression: z
    .object({
      decision_id: uuid,
      campaign_id: uuid,
      creative_id: uuid,
      placement: z.string().max(64),
      segment_key: z.string().max(64),
    })
    .passthrough(),
  ad_clicked: z
    .object({
      decision_id: uuid,
      campaign_id: uuid,
      creative_id: uuid,
      placement: z.string().max(64),
      segment_key: z.string().max(64),
    })
    .passthrough(),
  ad_converted: z
    .object({
      decision_id: uuid,
      campaign_id: uuid,
      creative_id: uuid,
      placement: z.string().max(64),
      segment_key: z.string().max(64),
      order_id: uuid,
      revenue_cents: cents,
    })
    .passthrough(),
  recommendation_clicked: z
    .object({
      decision_id: uuid,
      product_id: uuid,
      position: z.number().int().min(0),
      strategy: z.string().max(64),
    })
    .passthrough(),
} as const;

export type TrackEventType = keyof typeof trackPropertySchemas;

export const SERVER_ONLY_TRACK_EVENTS: readonly TrackEventType[] = ['ad_converted'];
export const TRACK_EVENT_TYPES = Object.keys(trackPropertySchemas) as TrackEventType[];

export const SUPPORTED_TRACK_SCHEMA_VERSIONS = [1] as const;

export const trackEventSchemas = Object.fromEntries(
  TRACK_EVENT_TYPES.map((type) => [type, envelopeSchema(type, trackPropertySchemas[type])]),
) as unknown as Record<TrackEventType, z.ZodType>;

export type TrackEvent = {
  [K in TrackEventType]: EventEnvelope<K, z.infer<(typeof trackPropertySchemas)[K]>>;
}[TrackEventType];

export const incomingTrackEventSchema = z.object({
  event_id: uuid,
  event_type: z.string().max(64),
  schema_version: z.number().int().min(1).default(1),
  occurred_at: z.iso.datetime({ offset: true }),
  anonymous_id: uuid.optional(),
  customer_id: uuid.optional(),
  session_id: uuid.optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
});

export type IncomingTrackEvent = z.infer<typeof incomingTrackEventSchema>;

export const collectBatchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(50),
  sent_at: z.iso.datetime({ offset: true }).optional(),
});

export const collectResponseSchema = z.object({
  accepted: z.number().int(),
  rejected: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});

export type CollectResponse = z.infer<typeof collectResponseSchema>;

export function isTrackEventType(value: string): value is TrackEventType {
  return Object.prototype.hasOwnProperty.call(trackPropertySchemas, value);
}

export function parseTrackEvent(
  event: unknown,
): { ok: true; event: TrackEvent } | { ok: false; reason: string } {
  if (!event || typeof event !== 'object') return { ok: false, reason: 'event must be an object' };
  const type = (event as { event_type?: unknown }).event_type;
  if (typeof type !== 'string' || !isTrackEventType(type)) return { ok: false, reason: 'unknown event_type' };
  const version = (event as { schema_version?: unknown }).schema_version ?? 1;
  if (!SUPPORTED_TRACK_SCHEMA_VERSIONS.includes(version as 1)) {
    return { ok: false, reason: `unsupported schema_version ${String(version)}` };
  }
  const result = trackEventSchemas[type].safeParse(event);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, reason: issue ? `${issue.path.join('.') || 'event'}: ${issue.message}` : 'invalid' };
  }
  return { ok: true, event: result.data as TrackEvent };
}
