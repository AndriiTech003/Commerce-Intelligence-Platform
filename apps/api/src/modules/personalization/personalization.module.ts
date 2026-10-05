import { Global, Module } from '@nestjs/common';
import {
  CANDIDATE_QUERIES,
  DECISION_LOG,
  PROFILE_SNAPSHOTS,
  PROFILE_STORE,
  RECO_STORE,
  SEGMENT_REPOSITORY,
} from './application/ports';
import { ProfileService } from './application/profile.service';
import { RecommendationService } from './application/recommendation.service';
import { SegmentService } from './application/segment.service';
import { ProfileSnapshotService } from './application/snapshot.service';
import { ProfilesController } from './http/profiles.controller';
import { RecommendationsController } from './http/recommendations.controller';
import { SegmentsController } from './http/segments.controller';
import { DrizzleCandidateQueries } from './infrastructure/candidate.queries';
import { RedisMqDecisionLog } from './infrastructure/decision-log';
import { PersonalizationJobs } from './infrastructure/personalization.jobs';
import { RedisProfileStore } from './infrastructure/redis-profile.store';
import { RedisRecoStore } from './infrastructure/redis-reco.store';
import { DrizzleSegmentRepository } from './infrastructure/segment.repository';
import { DrizzleProfileSnapshotRepository } from './infrastructure/snapshot.repository';

@Global()
@Module({
  controllers: [SegmentsController, ProfilesController, RecommendationsController],
  providers: [
    { provide: PROFILE_STORE, useClass: RedisProfileStore },
    { provide: PROFILE_SNAPSHOTS, useClass: DrizzleProfileSnapshotRepository },
    { provide: SEGMENT_REPOSITORY, useClass: DrizzleSegmentRepository },
    { provide: RECO_STORE, useClass: RedisRecoStore },
    { provide: CANDIDATE_QUERIES, useClass: DrizzleCandidateQueries },
    { provide: DECISION_LOG, useClass: RedisMqDecisionLog },
    ProfileService,
    SegmentService,
    RecommendationService,
    ProfileSnapshotService,
    PersonalizationJobs,
  ],
  exports: [
    ProfileService,
    SegmentService,
    RecommendationService,
    ProfileSnapshotService,
    PersonalizationJobs,
    DECISION_LOG,
    CANDIDATE_QUERIES,
  ],
})
export class PersonalizationModule {}
