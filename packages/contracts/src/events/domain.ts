import { z } from 'zod';
import { envelopeSchema, uuid, type EventEnvelope } from './envelope';

const cents = z.number().int();

export const domainPayloadSchemas = {
  'order.placed': z.object({
    order_id: uuid,
    number: z.number().int(),
    customer_id: uuid.nullish(),
    profile_id: uuid,
    email: z.string().optional(),
    items: z.array(
      z.object({
        product_id: uuid,
        variant_id: uuid,
        qty: z.number().int().min(1),
        unit_price_cents: cents,
        category_path: z.string(),
        title: z.string().optional(),
      }),
    ),
    total_cents: cents,
    currency: z.string().length(3),
    attribution: z.record(z.string(), z.unknown()).nullish(),
    discount_code: z.string().nullish(),
    discount_cents: cents.optional(),
  }),
  'order.paid': z.object({ order_id: uuid, amount_cents: cents, number: z.number().int().optional() }),
  'order.cancelled': z.object({ order_id: uuid, reason: z.string() }),
  'order.refunded': z.object({ order_id: uuid, amount_cents: cents, profile_id: uuid.optional() }),
  'order.fulfilled': z.object({ order_id: uuid }),
  'inventory.low_stock': z.object({
    variant_id: uuid,
    available: z.number().int(),
    threshold: z.number().int(),
  }),
  'product.upserted': z.object({ product_id: uuid, changed_fields: z.array(z.string()) }),
  'customer.identified': z.object({ customer_id: uuid, anonymous_id: uuid }),
  'creative.approved': z.object({ creative_id: uuid, campaign_id: uuid }),
} as const;

export type DomainEventType = keyof typeof domainPayloadSchemas;
export const DOMAIN_EVENT_TYPES = Object.keys(domainPayloadSchemas) as DomainEventType[];

export type DomainPayload<T extends DomainEventType> = z.infer<(typeof domainPayloadSchemas)[T]>;

export const domainEventSchemas = Object.fromEntries(
  DOMAIN_EVENT_TYPES.map((type) => [type, envelopeSchema(type, domainPayloadSchemas[type])]),
) as unknown as Record<DomainEventType, z.ZodType>;

export type DomainEvent = {
  [K in DomainEventType]: EventEnvelope<K, DomainPayload<K>>;
}[DomainEventType];

export function isDomainEventType(value: string): value is DomainEventType {
  return Object.prototype.hasOwnProperty.call(domainPayloadSchemas, value);
}

export function parseDomainEvent(
  event: unknown,
): { ok: true; event: DomainEvent } | { ok: false; reason: string } {
  if (!event || typeof event !== 'object') return { ok: false, reason: 'event must be an object' };
  const type = (event as { event_type?: unknown }).event_type;
  if (typeof type !== 'string' || !isDomainEventType(type))
    return { ok: false, reason: 'unknown event_type' };
  const result = domainEventSchemas[type].safeParse(event);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, reason: issue ? `${issue.path.join('.') || 'event'}: ${issue.message}` : 'invalid' };
  }
  return { ok: true, event: result.data as DomainEvent };
}
