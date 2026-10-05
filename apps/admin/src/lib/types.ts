import type { paths } from '@cip/api-client';

type JsonOf<R> = R extends { content: { 'application/json': infer B } } ? B : never;

type Success<O> = O extends { responses: infer R }
  ? R extends { 200: infer S }
    ? JsonOf<S>
    : R extends { 201: infer S }
      ? JsonOf<S>
      : R extends { 202: infer S }
        ? JsonOf<S>
        : never
  : never;

export type ProfileView = Success<paths['/v1/admin/customers/{id}/profile']['get']>;
export type Segment = Success<paths['/v1/admin/segments']['get']>['data'][number];
export type SegmentFeatures = Success<paths['/v1/admin/segments/features']['get']>;
export type SegmentPreview = Success<paths['/v1/admin/segments/preview']['post']>;
export type Campaign = Success<paths['/v1/admin/campaigns']['get']>['data'][number];
export type CampaignDetail = Success<paths['/v1/admin/campaigns/{id}']['get']>;
export type Creative = CampaignDetail['creatives'][number];
export type ReviewQueue = Success<paths['/v1/admin/creatives/review-queue']['get']>;
export type ReviewItem = ReviewQueue['data'][number];
export type Experiment = Success<paths['/v1/admin/campaigns/{id}/experiment']['get']>;
export type ExperimentSegment = Experiment['segments'][number];
export type ExperimentArm = ExperimentSegment['arms'][number];
export type PreviewProducts = Success<paths['/v1/admin/campaigns/preview-products']['post']>;
export type PreviewProduct = PreviewProducts['products'][number];
export type ProductSelector = Campaign['productSelector'];
export type Placement = Campaign['placement'];
export type Job = Success<paths['/v1/admin/jobs/{id}']['get']>;
export type AiFeatures = Success<paths['/v1/admin/features']['get']>;
export type Insights = Success<paths['/v1/admin/analytics/insights']['get']>;
export type WebhookEndpoint = Success<paths['/v1/admin/webhooks']['get']>['data'][number];
export type WebhookCreated = Success<paths['/v1/admin/webhooks']['post']>;
export type WebhookDelivery = Success<paths['/v1/admin/webhooks/{id}/deliveries']['get']>['data'][number];
export type WebhookEvent = WebhookEndpoint['events'][number];
export type ImportAccepted = Success<paths['/v1/admin/products/import']['post']>;
export type SimulatorState = Success<paths['/v1/platform/simulator']['get']>;
export type GroundTruth = Success<paths['/v1/platform/simulator/ground-truth']['get']>;
export type Category = Success<paths['/v1/admin/categories']['get']>['data'][number];
