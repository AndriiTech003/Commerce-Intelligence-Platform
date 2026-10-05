import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_SEGMENT, probabilityBest, wilsonInterval } from '@cip/personalization';
import { NotFoundError } from '../../../shared/errors';
import { requireTenant } from '../../../shared/http/actor';
import {
  BANDIT_STORE,
  CAMPAIGN_REPOSITORY,
  type BanditStore,
  type CampaignRepository,
} from '../../campaigns';
import { DECISION_LOG, type DecisionLog } from '../../personalization';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { EXPERIMENT_QUERIES, type ExperimentQueries } from './ports';

@Injectable()
export class ExperimentService {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(BANDIT_STORE) private readonly bandit: BanditStore,
    @Inject(EXPERIMENT_QUERIES) private readonly queries: ExperimentQueries,
    @Inject(DECISION_LOG) private readonly decisions: DecisionLog,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async experiment(campaignId: string, options: { hours?: number } = {}) {
    const tenantId = requireTenant();
    const { campaign, creatives, history } = await this.uow.run(async () => {
      const found = await this.campaigns.find(campaignId);
      if (!found) throw new NotFoundError('Campaign', campaignId);
      return {
        campaign: found,
        creatives: (await this.campaigns.creatives(campaignId)).filter((c) =>
          ['approved', 'active', 'paused'].includes(c.status),
        ),
        history: await this.campaigns.banditHistory(campaignId, new Date(Date.now() - 48 * 3600_000)),
      };
    });
    const segmentKeys = [
      ...new Set([...campaign.targetSegments, DEFAULT_SEGMENT, ...(await this.bandit.segments(campaignId))]),
    ];
    const ids = creatives.map((c) => c.id);
    const byId = new Map(creatives.map((c) => [c.id, c]));
    const segments = [];
    for (const segmentKey of segmentKeys) {
      const arms = ids.length > 0 ? await this.bandit.arms(campaignId, segmentKey, ids) : [];
      const pBest = probabilityBest(
        arms.map((a) => ({ alpha: a.alpha, beta: a.beta })),
        10000,
      );
      const impressions = arms.reduce((s, a) => s + a.impressions, 0);
      if (
        impressions === 0 &&
        !campaign.targetSegments.includes(segmentKey) &&
        segmentKey !== DEFAULT_SEGMENT
      )
        continue;
      segments.push({
        segmentKey,
        impressions,
        successes: arms.reduce((s, a) => s + a.successes, 0),
        arms: arms.map((arm, i) => {
          const interval = wilsonInterval(arm.successes, arm.impressions);
          const creative = byId.get(arm.creativeId)!;
          return {
            creativeId: arm.creativeId,
            headline: creative.headline,
            tone: creative.tone,
            status: creative.status,
            alpha: arm.alpha,
            beta: arm.beta,
            impressions: arm.impressions,
            successes: arm.successes,
            rate: interval.rate,
            low: interval.low,
            high: interval.high,
            pBest: pBest[i] ?? 0,
          };
        }),
      });
    }
    const ageHours = (Date.now() - campaign.createdAt.getTime()) / 3600_000;
    const hours = options.hours ?? Math.min(48, Math.max(1, Math.ceil(ageHours)));
    const interval = hours <= 6 ? 'minute' : 'hour';
    const [totals, points, regret] = await Promise.all([
      this.queries.policyTotals(tenantId, campaignId),
      this.queries.traffic(tenantId, campaignId, interval, new Date(Date.now() - hours * 3600_000)),
      this.queries.regret(campaignId),
    ]);
    const group = (holdout: boolean) => {
      const row = totals.find((t) => t.holdout === holdout) ?? { impressions: 0, clicks: 0, conversions: 0 };
      const successes = campaign.goal === 'conversion' ? row.conversions : row.clicks;
      return {
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: row.conversions,
        rate: row.impressions > 0 ? successes / row.impressions : 0,
      };
    };
    return {
      campaignId,
      name: campaign.name,
      goal: campaign.goal,
      status: campaign.status,
      segments,
      holdout: group(true),
      personalized: group(false),
      traffic: { interval: interval as 'minute' | 'hour', points },
      history: history.map((h) => ({ ...h, snapshotAt: h.snapshotAt.toISOString() })),
      regret,
    };
  }

  async decision(decisionId: string) {
    const tenantId = requireTenant();
    const live = await this.decisions.get(decisionId);
    if (live && live.tenantId === tenantId) return { source: 'redis', ...live };
    const row = await this.queries.decision(tenantId, decisionId);
    if (!row) throw new NotFoundError('Decision', decisionId);
    return {
      source: 'clickhouse',
      tenantId,
      decisionId,
      profileId: String(row.profile_id),
      placement: String(row.placement),
      segmentKey: String(row.segment_key),
      campaignId: String(row.campaign_id),
      creativeId: String(row.creative_id),
      policy: String(row.policy),
      explanation: JSON.parse(String(row.explanation || '{}')) as Record<string, unknown>,
    };
  }
}
