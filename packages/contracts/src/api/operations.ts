import { z } from 'zod';
import { uuid } from '../events/envelope';

export const WEBHOOK_EVENTS = ['order.paid', 'order.refunded'] as const;
export const WEBHOOK_RETRY_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 43200] as const;

export const webhookEndpointSchema = z.object({
  id: uuid,
  url: z.string(),
  events: z.array(z.enum(WEBHOOK_EVENTS)),
  status: z.enum(['active', 'disabled']),
  secretPrefix: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  disabledAt: z.string().nullable(),
  lastDeliveryAt: z.string().nullable(),
});

export const webhookEndpointCreatedSchema = webhookEndpointSchema.extend({ secret: z.string() });

export const webhookCreateSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//.test(u), 'http(s) URL required'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  description: z.string().trim().max(200).optional(),
});

export const webhookUpdateSchema = z.object({
  url: z.string().trim().url().max(2000).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  description: z.string().trim().max(200).nullish(),
});

export const webhookDeliverySchema = z.object({
  id: uuid,
  endpointId: uuid,
  eventId: z.string(),
  eventType: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed', 'dead']),
  attempts: z.number().int(),
  nextAttemptAt: z.string().nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  deliveredAt: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

export const importAcceptedSchema = z.object({ jobId: uuid, status: z.string() });

export const insightSchema = z.object({
  generatedAt: z.string(),
  model: z.string(),
  cached: z.boolean(),
  period: z.object({ from: z.string(), to: z.string() }),
  observations: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      severity: z.enum(['info', 'positive', 'warning']),
      basis: z.array(z.object({ metric: z.string(), value: z.union([z.number(), z.string()]) })),
    }),
  ),
  aggregates: z.record(z.string(), z.unknown()),
});

export const simulatorStateSchema = z.object({
  running: z.boolean(),
  rate: z.number(),
  personas: z.record(z.string(), z.number()),
  shifted: z.record(z.string(), z.record(z.string(), z.number())),
  mode: z.string(),
  updatedAt: z.string().nullable(),
  stats: z.record(z.string(), z.number()),
});

export const simulatorCommandSchema = z.object({
  action: z.enum(['start', 'stop', 'shift', 'reset_shift']),
  rate: z.number().min(0.1).max(500).optional(),
  personas: z.record(z.string(), z.number().min(0)).optional(),
  shift: z
    .object({ persona: z.string().max(64), toneMultipliers: z.record(z.string(), z.number().min(0).max(10)) })
    .optional(),
});

export const groundTruthSchema = z.object({
  campaignId: z.string().nullable(),
  campaignName: z.string().nullable(),
  rows: z.array(
    z.object({
      persona: z.string(),
      trueBestTone: z.string(),
      toneMultipliers: z.record(z.string(), z.number()),
      sessions: z.number(),
      segmentKey: z.string().nullable(),
      segmentShare: z.number(),
      learnedTone: z.string().nullable(),
      pBest: z.number().nullable(),
      impressions: z.number(),
      correct: z.boolean(),
    }),
  ),
  regret: z.object({ thompson: z.number(), uniform: z.number(), decisions: z.number() }).nullable(),
});
