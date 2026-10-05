export { CampaignsModule } from './campaigns.module';
export { CampaignService } from './application/campaign.service';
export { CreativeService } from './application/creative.service';
export { DecisionService, type DecisionResult } from './application/decision.service';
export { FeedbackService, parseFeedback } from './application/feedback.service';
export { BanditSnapshotJob } from './infrastructure/campaign.jobs';
export {
  CAMPAIGN_REPOSITORY,
  BANDIT_STORE,
  ATTRIBUTION_STORE,
  type CampaignRepository,
  type BanditStore,
  type AttributionStore,
} from './application/ports';
export {
  checkGuardrails,
  detectLanguage,
  verifyClaims,
  blocksApproval,
  type GuardrailContext,
} from './domain/guardrails';
export type { CreativeOutput } from './domain/prompt';
export {
  CREATIVE_PROMPT_VERSION,
  creativeOutputSchema,
  promptVariables,
  splitPromptFile,
  inputHash,
} from './domain/prompt';
export { isServable, isLive, type Campaign, type Creative } from './domain/campaign';
