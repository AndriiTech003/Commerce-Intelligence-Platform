import { Inject, Injectable } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import type { RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import { CLICKHOUSE, KEYS, REDIS } from '../../../shared/tokens';
import type { ExperimentQueries } from '../application/ports';

function chTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class ClickHouseExperimentQueries implements ExperimentQueries {
  constructor(
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  private async rows<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
    const result = await this.ch.query({ query, query_params: params, format: 'JSONEachRow' });
    return result.json<T>();
  }

  async policyTotals(tenantId: string, campaignId: string) {
    const rows = await this.rows<{
      holdout: number;
      impressions: string;
      clicks: string;
      conversions: string;
    }>(
      `SELECT d.policy = 'holdout_uniform' AS holdout,
         uniqExactIf(e.event_id, e.event_type = 'ad_impression') AS impressions,
         uniqExactIf(e.event_id, e.event_type = 'ad_clicked') AS clicks,
         uniqExactIf(e.event_id, e.event_type = 'ad_converted') AS conversions
       FROM events AS e
       INNER JOIN (SELECT decision_id, any(policy) AS policy FROM decisions
                   WHERE tenant_id = {tenant:UUID} AND campaign_id = {campaign:UUID} GROUP BY decision_id) AS d
         ON assumeNotNull(e.decision_id) = d.decision_id
       WHERE e.tenant_id = {tenant:UUID} AND e.campaign_id = {campaign:UUID}
         AND e.event_type IN ('ad_impression', 'ad_clicked', 'ad_converted')
       GROUP BY holdout`,
      { tenant: tenantId, campaign: campaignId },
    );
    return rows.map((r) => ({
      holdout: Number(r.holdout) === 1,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      conversions: Number(r.conversions),
    }));
  }

  async traffic(tenantId: string, campaignId: string, interval: 'minute' | 'hour', since: Date) {
    const bucket = interval === 'minute' ? 'toStartOfMinute' : 'toStartOfHour';
    const rows = await this.rows<{ t: string; segment_key: string; creative_id: string; n: string }>(
      `SELECT formatDateTime(${bucket}(decided_at), '%FT%TZ', 'UTC') AS t, segment_key, toString(creative_id) AS creative_id, count() AS n
       FROM decisions
       WHERE tenant_id = {tenant:UUID} AND campaign_id = {campaign:UUID} AND decided_at >= {since:DateTime64(3, 'UTC')}
         AND policy != 'holdout_uniform'
       GROUP BY t, segment_key, creative_id ORDER BY t`,
      { tenant: tenantId, campaign: campaignId, since: chTime(since) },
    );
    return rows.map((r) => ({
      t: r.t,
      segmentKey: r.segment_key,
      creativeId: r.creative_id,
      decisions: Number(r.n),
    }));
  }

  async decision(tenantId: string, decisionId: string) {
    const rows = await this.rows<Record<string, unknown>>(
      `SELECT toString(decision_id) AS decision_id, placement, toString(profile_id) AS profile_id, segment_key,
         toString(campaign_id) AS campaign_id, toString(creative_id) AS creative_id, policy, explanation,
         toString(decided_at) AS decided_at
       FROM decisions WHERE tenant_id = {tenant:UUID} AND decision_id = {id:UUID} LIMIT 1`,
      { tenant: tenantId, id: decisionId },
    );
    return rows[0] ?? null;
  }

  async regret(campaignId: string) {
    const raw = await this.redis.hget(this.keys.simRegret(), campaignId);
    return raw ? (JSON.parse(raw) as Awaited<ReturnType<ExperimentQueries['regret']>>) : null;
  }
}
