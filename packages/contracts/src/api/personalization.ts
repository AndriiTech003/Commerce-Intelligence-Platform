import { z } from 'zod';
import { uuid } from '../events/envelope';
import { storefrontProductCardSchema } from './catalog';

export const PLACEMENTS = ['home_hero', 'pdp_sidebar', 'cart_upsell', 'category_banner'] as const;
export const placementSchema = z.enum(PLACEMENTS);
export type Placement = (typeof PLACEMENTS)[number];

export const TONES = ['performance', 'lifestyle', 'value', 'premium'] as const;
export const toneSchema = z.enum(TONES);
export type Tone = (typeof TONES)[number];

export const RECOMMENDATION_TYPES = ['for_you', 'similar', 'bought_together', 'cart_upsell'] as const;

export const segmentKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores');

export const segmentRulesInputSchema = z
  .record(z.string(), z.unknown())
  .describe('Rule group {all:[…]} or {any:[…]} of {feature, op, value} conditions; see docs/06');

export const segmentSchema = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  rules: z.record(z.string(), z.unknown()),
  description: z.string(),
  priority: z.number().int(),
  isSystem: z.boolean(),
  members: z.number().int(),
});

export const segmentCreateSchema = z.object({
  key: segmentKeySchema,
  name: z.string().trim().min(1).max(120),
  rules: segmentRulesInputSchema,
  priority: z.number().int().min(0).max(10000).default(100),
});

export const segmentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  rules: segmentRulesInputSchema.optional(),
  priority: z.number().int().min(0).max(10000).optional(),
});

export const segmentPreviewRequestSchema = z.object({ rules: segmentRulesInputSchema });

export const segmentPreviewSchema = z.object({
  count: z.number().int(),
  total: z.number().int(),
  description: z.string(),
  sample: z.array(
    z.object({ profileId: z.string(), customerId: z.string().nullable(), reasons: z.array(z.string()) }),
  ),
});

export const segmentFeaturesSchema = z.object({
  features: z.array(z.object({ name: z.string(), kind: z.string(), help: z.string() })),
  categories: z.array(z.string()),
  brands: z.array(z.string()),
});

export const segmentMembershipSchema = z.object({
  key: z.string(),
  name: z.string(),
  priority: z.number().int(),
  reasons: z.array(z.string()),
});

export const profileViewSchema = z.object({
  profileId: z.string().nullable(),
  customerId: z.string().nullable(),
  source: z.enum(['live', 'snapshot', 'none']),
  features: z.record(z.string(), z.unknown()),
  affinity: z.object({
    categories: z.array(z.object({ key: z.string(), score: z.number() })),
    brands: z.array(z.object({ key: z.string(), score: z.number() })),
    tones: z.array(z.object({ key: z.string(), score: z.number() })),
  }),
  priceBand: z.string().nullable(),
  priceEwmaCents: z.number().nullable(),
  intent: z.number(),
  segments: z.array(segmentMembershipSchema),
  signals: z.array(z.string()),
  recentProducts: z.array(z.string()),
  updatedAt: z.string().nullable(),
});

export const contributionsSchema = z.object({
  similarity: z.number(),
  affinity: z.number(),
  popularity: z.number(),
  priceFit: z.number(),
  freshness: z.number(),
});

export const recommendationQuerySchema = z.object({
  type: z.enum(RECOMMENDATION_TYPES).default('for_you'),
  productId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(24).default(8),
});

export const recommendedProductSchema = storefrontProductCardSchema.extend({
  score: z.number(),
  strategies: z.array(z.string()),
  contributions: contributionsSchema,
});

export const recommendationResponseSchema = z.object({
  decisionId: uuid,
  type: z.enum(RECOMMENDATION_TYPES),
  coldStart: z.boolean(),
  cached: z.boolean(),
  items: z.array(recommendedProductSchema),
});

export const decisionQuerySchema = z.object({
  placement: placementSchema,
  productId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(12).default(4),
});

export const armExplanationSchema = z.object({
  id: z.string(),
  tone: z.string().nullable(),
  headline: z.string(),
  impressions: z.number(),
  ctr: z.number(),
  sampled: z.number().nullable(),
  pBest: z.number(),
});

export const explanationSchema = z.object({
  decisionId: z.string(),
  placement: z.string(),
  decidedAt: z.string(),
  segment: z.object({ key: z.string(), name: z.string(), matchedRules: z.array(z.string()) }),
  otherSegments: z.array(z.string()),
  profileSignals: z.array(z.string()),
  coldStart: z.boolean(),
  creative: z.object({
    chosen: z.string(),
    headline: z.string(),
    tone: z.string().nullable(),
    policy: z.string(),
    arms: z.array(armExplanationSchema),
  }),
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      score: z.number(),
      strategies: z.array(z.string()),
      contributions: contributionsSchema,
    }),
  ),
  text: z.array(z.string()),
});
export type Explanation = z.infer<typeof explanationSchema>;

export const creativeContentSchema = z.object({
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
  tone: z.string().nullable(),
});

export const decisionResponseSchema = z.object({
  decisionId: uuid,
  placement: placementSchema,
  campaignId: uuid,
  creativeId: uuid,
  segmentKey: z.string(),
  policy: z.string(),
  creative: creativeContentSchema,
  products: z.array(storefrontProductCardSchema),
});
