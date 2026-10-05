import { z } from 'zod';
import { uuid } from './envelope';

export const DECISION_ROUTING_KEY = 'decision.made';

export const decisionMadeSchema = z.object({
  decision_id: uuid,
  tenant_id: uuid,
  placement: z.string().max(64),
  profile_id: uuid,
  segment_key: z.string().max(64),
  campaign_id: uuid.nullable(),
  creative_id: uuid.nullable(),
  product_ids: z.array(uuid).max(50),
  sampled_scores: z.record(z.string(), z.number()),
  policy: z.string().max(64),
  explanation: z.record(z.string(), z.unknown()),
  decided_at: z.iso.datetime({ offset: true }),
});

export type DecisionMade = z.infer<typeof decisionMadeSchema>;
