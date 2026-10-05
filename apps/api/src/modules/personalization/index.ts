export { PersonalizationModule } from './personalization.module';
export { ProfileService, type LoadedProfile } from './application/profile.service';
export { SegmentService, parseRules } from './application/segment.service';
export {
  RecommendationService,
  currentProfileId,
  type ProductCard,
  type ProfileContext,
  type RankedCard,
} from './application/recommendation.service';
export { ProfileSnapshotService } from './application/snapshot.service';
export { PersonalizationJobs, withRedisLock } from './infrastructure/personalization.jobs';
export {
  DECISION_LOG,
  CANDIDATE_QUERIES,
  type DecisionLog,
  type DecisionRecord,
  type CandidateQueries,
  type CandidateRow,
} from './application/ports';
