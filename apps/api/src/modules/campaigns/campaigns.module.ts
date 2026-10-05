import { Global, Module } from '@nestjs/common';
import { CampaignService } from './application/campaign.service';
import { CreativeService } from './application/creative.service';
import { DecisionService } from './application/decision.service';
import { FeedbackService } from './application/feedback.service';
import {
  ATTRIBUTION_STORE,
  BANDIT_STORE,
  CAMPAIGN_REPOSITORY,
  LLM_GUARD,
  PROMPT_TEMPLATES,
  TRACK_PUBLISHER,
} from './application/ports';
import { CampaignsController } from './http/campaigns.controller';
import { CreativesController } from './http/creatives.controller';
import { DecisionsController } from './http/decisions.controller';
import { BanditSnapshotJob } from './infrastructure/campaign.jobs';
import { DrizzleCampaignRepository } from './infrastructure/campaign.repository';
import { BanditFeedbackConsumer } from './infrastructure/feedback.consumer';
import { FilePromptTemplates } from './infrastructure/prompt-templates';
import { RedisBanditStore } from './infrastructure/redis-bandit.store';
import { AmqpTrackPublisher, RedisAttributionStore, RedisLlmGuard } from './infrastructure/redis-adapters';

@Global()
@Module({
  controllers: [CampaignsController, CreativesController, DecisionsController],
  providers: [
    { provide: CAMPAIGN_REPOSITORY, useClass: DrizzleCampaignRepository },
    { provide: BANDIT_STORE, useClass: RedisBanditStore },
    { provide: PROMPT_TEMPLATES, useClass: FilePromptTemplates },
    { provide: LLM_GUARD, useClass: RedisLlmGuard },
    { provide: ATTRIBUTION_STORE, useClass: RedisAttributionStore },
    { provide: TRACK_PUBLISHER, useClass: AmqpTrackPublisher },
    CampaignService,
    CreativeService,
    DecisionService,
    FeedbackService,
    BanditFeedbackConsumer,
    BanditSnapshotJob,
  ],
  exports: [
    CampaignService,
    CreativeService,
    DecisionService,
    FeedbackService,
    BanditSnapshotJob,
    CAMPAIGN_REPOSITORY,
    BANDIT_STORE,
    ATTRIBUTION_STORE,
  ],
})
export class CampaignsModule {}
