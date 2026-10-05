import { z } from 'zod';
import { uuid } from '../events/envelope';
import { storefrontProductCardSchema } from './catalog';
import { placementSchema, toneSchema } from './personalization';

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export const CREATIVE_STATUSES = ['draft', 'approved', 'rejected', 'active', 'paused'] as const;
export const GUARDRAIL_FLAGS = [
  'too_long',
  'unverified_claim',
  'banned_claim',
  'profanity',
  'near_duplicate',
  'language_mismatch',
  'prompt_injection',
] as const;
export const BLOCKING_FLAGS = ['too_long', 'profanity'] as const;
export const APPROVAL_BLOCKING_FLAGS = [
  'too_long',
  'profanity',
  'unverified_claim',
  'prompt_injection',
] as const;

export const productSelectorSchema = z
  .object({
    categoryPath: z.string().trim().max(200).optional(),
    brands: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    priceMin: z.number().int().min(0).optional(),
    priceMax: z.number().int().min(0).optional(),
    productIds: z.array(uuid).max(50).optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export type ProductSelector = z.infer<typeof productSelectorSchema>;

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  placement: placementSchema,
  targetSegments: z.array(z.string().max(48)).max(20).default([]),
  productSelector: productSelectorSchema.default({}),
  goal: z.enum(['click', 'conversion']).default('click'),
  startsAt: z.iso.datetime({ offset: true }).nullish(),
  endsAt: z.iso.datetime({ offset: true }).nullish(),
});

export const campaignUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  targetSegments: z.array(z.string().max(48)).max(20).optional(),
  productSelector: productSelectorSchema.optional(),
  goal: z.enum(['click', 'conversion']).optional(),
  startsAt: z.iso.datetime({ offset: true }).nullish(),
  endsAt: z.iso.datetime({ offset: true }).nullish(),
});

export const generationInfoSchema = z
  .object({
    model: z.string(),
    provider: z.string(),
    promptVersion: z.string(),
    inputHash: z.string(),
    latencyMs: z.number(),
    tokens: z.object({ input: z.number(), output: z.number() }),
    costUsd: z.number(),
    cached: z.boolean(),
    rationale: z.string(),
    attempts: z.number().int(),
    flagDetails: z.array(z.string()),
  })
  .partial();

export const creativeSchema = z.object({
  id: uuid,
  campaignId: uuid,
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
  tone: z.string().nullable(),
  targetSegment: z.string().nullable(),
  status: z.enum(CREATIVE_STATUSES),
  source: z.enum(['llm', 'human']),
  generation: generationInfoSchema.nullable(),
  guardrailFlags: z.array(z.string()),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewComment: z.string().nullable(),
  createdAt: z.string(),
});

export const campaignSchema = z.object({
  id: uuid,
  name: z.string(),
  placement: placementSchema,
  status: z.enum(CAMPAIGN_STATUSES),
  targetSegments: z.array(z.string()),
  productSelector: productSelectorSchema,
  goal: z.enum(['click', 'conversion']),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
  creativeCounts: z.record(z.string(), z.number().int()),
});

export const campaignDetailSchema = campaignSchema.extend({ creatives: z.array(creativeSchema) });

export const productPreviewSchema = z.object({
  total: z.number().int(),
  products: z.array(storefrontProductCardSchema),
});

export const generateCreativesSchema = z.object({
  segments: z.array(z.string().max(48)).min(1).max(6),
  tones: z.array(toneSchema).min(1).max(4),
  count: z.number().int().min(1).max(5).default(3),
  async: z.boolean().default(false),
});

export const jobSchema = z.object({
  id: uuid,
  type: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  total: z.number().int(),
  processed: z.number().int(),
  failed: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
  result: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const generateResponseSchema = z.object({
  jobId: uuid,
  status: z.string(),
  creatives: z.array(creativeSchema),
  errors: z.array(z.string()),
});

export const creativeInputSchema = z.object({
  headline: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(400),
  cta: z.string().trim().min(1).max(100),
  tone: toneSchema.nullish(),
  targetSegment: z.string().max(48).nullish(),
});

export const creativeUpdateSchema = z.object({
  headline: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(400).optional(),
  cta: z.string().trim().min(1).max(100).optional(),
  tone: toneSchema.nullish(),
  status: z.enum(['active', 'paused']).optional(),
});

export const creativeReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(500).optional(),
});

export const reviewQueueItemSchema = creativeSchema.extend({
  campaignName: z.string(),
  placement: z.string(),
});

export const experimentArmSchema = z.object({
  creativeId: uuid,
  headline: z.string(),
  tone: z.string().nullable(),
  status: z.string(),
  alpha: z.number(),
  beta: z.number(),
  impressions: z.number(),
  successes: z.number(),
  rate: z.number(),
  low: z.number(),
  high: z.number(),
  pBest: z.number(),
});

export const experimentSchema = z.object({
  campaignId: uuid,
  name: z.string(),
  goal: z.string(),
  status: z.string(),
  segments: z.array(
    z.object({
      segmentKey: z.string(),
      impressions: z.number(),
      successes: z.number(),
      arms: z.array(experimentArmSchema),
    }),
  ),
  holdout: z.object({
    impressions: z.number(),
    clicks: z.number(),
    conversions: z.number(),
    rate: z.number(),
  }),
  personalized: z.object({
    impressions: z.number(),
    clicks: z.number(),
    conversions: z.number(),
    rate: z.number(),
  }),
  traffic: z.object({
    interval: z.enum(['minute', 'hour']),
    points: z.array(
      z.object({ t: z.string(), segmentKey: z.string(), creativeId: z.string(), decisions: z.number() }),
    ),
  }),
  history: z.array(
    z.object({
      snapshotAt: z.string(),
      segmentKey: z.string(),
      creativeId: z.string(),
      alpha: z.number(),
      beta: z.number(),
    }),
  ),
  regret: z
    .object({
      thompson: z.number(),
      uniform: z.number(),
      decisions: z.number(),
      series: z.array(z.object({ t: z.number(), thompson: z.number(), uniform: z.number() })),
    })
    .nullable(),
});
