import { z } from 'zod';

export const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'uuid');

export const eventContextSchema = z.object({
  page: z
    .object({
      url: z.string().max(2048),
      path: z.string().max(1024),
      referrer: z.string().max(2048).optional(),
      title: z.string().max(512).optional(),
    })
    .optional(),
  user_agent: z.string().max(1024).optional(),
  locale: z.string().max(32).optional(),
  country: z.string().max(8).optional(),
  device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
  campaign: z
    .object({
      utm_source: z.string().max(256).optional(),
      utm_medium: z.string().max(256).optional(),
      utm_campaign: z.string().max(256).optional(),
    })
    .optional(),
});

export type EventContext = z.infer<typeof eventContextSchema>;

export function envelopeSchema<TType extends string, TProps extends z.ZodType>(
  type: TType,
  properties: TProps,
) {
  return z.object({
    event_id: uuid,
    event_type: z.literal(type),
    schema_version: z.number().int().min(1),
    tenant_id: uuid,
    occurred_at: z.iso.datetime({ offset: true }),
    received_at: z.iso.datetime({ offset: true }).optional(),
    anonymous_id: uuid.optional(),
    customer_id: uuid.optional(),
    session_id: uuid.optional(),
    context: eventContextSchema.optional(),
    properties,
  });
}

export interface EventEnvelope<TType extends string = string, TProps = Record<string, unknown>> {
  event_id: string;
  event_type: TType;
  schema_version: number;
  tenant_id: string;
  occurred_at: string;
  received_at?: string;
  anonymous_id?: string;
  customer_id?: string;
  session_id?: string;
  context?: EventContext;
  properties: TProps;
}

export const CLOCK_SKEW_LIMIT_MS = 24 * 60 * 60 * 1000;

export function normalizeOccurredAt(
  occurredAt: string,
  receivedAt: string,
): { occurred_at: string; clock_skew: boolean } {
  const occurred = Date.parse(occurredAt);
  const received = Date.parse(receivedAt);
  if (!Number.isFinite(occurred) || Math.abs(received - occurred) > CLOCK_SKEW_LIMIT_MS) {
    return { occurred_at: receivedAt, clock_skew: true };
  }
  return { occurred_at: new Date(occurred).toISOString(), clock_skew: false };
}
