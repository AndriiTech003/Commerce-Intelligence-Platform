import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type ProductSelector, type RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import { NotFoundError, ValidationFailedError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import { KEYS, REDIS } from '../../../shared/tokens';
import {
  CANDIDATE_QUERIES,
  RecommendationService,
  SegmentService,
  type CandidateQueries,
} from '../../personalization';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  CAMPAIGN_TRANSITIONS,
  canTransition,
  InvalidStateError,
  type Campaign,
  type Creative,
} from '../domain/campaign';
import { CAMPAIGN_REPOSITORY, type CampaignRepository, type CampaignWrite } from './ports';

export interface CampaignInput {
  name: string;
  placement: Campaign['placement'];
  targetSegments: string[];
  productSelector: ProductSelector;
  goal: 'click' | 'conversion';
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}

@Injectable()
export class CampaignService {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly repo: CampaignRepository,
    @Inject(CANDIDATE_QUERIES) private readonly candidates: CandidateQueries,
    @Inject(RecommendationService) private readonly recommendations: RecommendationService,
    @Inject(SegmentService) private readonly segments: SegmentService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  creativeView(c: Creative) {
    return {
      id: c.id,
      campaignId: c.campaignId,
      headline: c.headline,
      body: c.body,
      cta: c.cta,
      tone: c.tone,
      targetSegment: c.targetSegment,
      status: c.status,
      source: c.source,
      generation: c.generation,
      guardrailFlags: c.guardrailFlags,
      reviewedBy: c.reviewedBy,
      reviewedAt: c.reviewedAt?.toISOString() ?? null,
      reviewComment: c.reviewComment,
      createdAt: c.createdAt.toISOString(),
    };
  }

  view(c: Campaign, creativeCounts: Record<string, number> = {}) {
    return {
      id: c.id,
      name: c.name,
      placement: c.placement,
      status: c.status,
      targetSegments: c.targetSegments,
      productSelector: c.productSelector,
      goal: c.goal,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      creativeCounts,
    };
  }

  async bumpVersion(): Promise<void> {
    const tenantId = currentContext()?.tenantId;
    if (tenantId) await this.redis.incr(this.keys.campaignsVersion(tenantId));
  }

  private async validateSegments(keys: string[]): Promise<void> {
    const tenantId = currentContext()!.tenantId!;
    const known = new Set((await this.segments.compiledFor(tenantId)).map((s) => s.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length > 0) throw new ValidationFailedError(`Unknown segments: ${unknown.join(', ')}`);
  }

  async list() {
    const rows = await this.uow.run(() => this.repo.list());
    return { data: rows.map((r) => this.view(r, r.creativeCounts)) };
  }

  async get(id: string) {
    return this.uow.run(async () => {
      const campaign = await this.repo.find(id);
      if (!campaign) throw new NotFoundError('Campaign', id);
      const creatives = await this.repo.creatives(id);
      const counts: Record<string, number> = {};
      for (const c of creatives) counts[c.status] = (counts[c.status] ?? 0) + 1;
      return { ...this.view(campaign, counts), creatives: creatives.map((c) => this.creativeView(c)) };
    });
  }

  async create(input: CampaignInput) {
    await this.validateSegments(input.targetSegments);
    const actor = currentContext()?.actor;
    const write: CampaignWrite = {
      name: input.name,
      placement: input.placement,
      status: 'draft',
      targetSegments: input.targetSegments,
      productSelector: input.productSelector,
      goal: input.goal,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      createdBy: actor?.type === 'user' ? actor.id : null,
    };
    const created = await this.uow.run(() => this.repo.insert(uuidv7(), write));
    return this.view(created);
  }

  async update(id: string, patch: Partial<CampaignInput> & { status?: Campaign['status'] | undefined }) {
    if (patch.targetSegments) await this.validateSegments(patch.targetSegments);
    const result = await this.uow.run(async () => {
      const before = await this.repo.find(id);
      if (!before) throw new NotFoundError('Campaign', id);
      if (patch.status && !canTransition(CAMPAIGN_TRANSITIONS, before.status, patch.status))
        throw new InvalidStateError(`Campaign cannot go from ${before.status} to ${patch.status}`);
      const write: Partial<CampaignWrite> = {};
      if (patch.name !== undefined) write.name = patch.name;
      if (patch.status !== undefined) write.status = patch.status;
      if (patch.targetSegments !== undefined) write.targetSegments = patch.targetSegments;
      if (patch.productSelector !== undefined) write.productSelector = patch.productSelector;
      if (patch.goal !== undefined) write.goal = patch.goal;
      if (patch.startsAt !== undefined) write.startsAt = patch.startsAt ? new Date(patch.startsAt) : null;
      if (patch.endsAt !== undefined) write.endsAt = patch.endsAt ? new Date(patch.endsAt) : null;
      const after = (await this.repo.update(id, write))!;
      if (patch.status === 'active' && before.status !== 'active') await this.repo.activateApproved(id);
      return { before: this.view(before), after: this.view(after) };
    });
    await this.bumpVersion();
    return result;
  }

  async previewProducts(selector: ProductSelector, limit = 12) {
    const tenantId = currentContext()!.tenantId!;
    const { total, ids } = await this.uow.run(() => this.candidates.select(selector, limit));
    const rows = await this.recommendations.rows(tenantId, ids);
    return {
      total,
      products: ids.flatMap((id) => (rows.has(id) ? [this.recommendations.card(rows.get(id)!)] : [])),
    };
  }
}
