export const EXPERIMENT_QUERIES = Symbol('EXPERIMENT_QUERIES');

export interface ExperimentQueries {
  policyTotals(
    tenantId: string,
    campaignId: string,
  ): Promise<Array<{ holdout: boolean; impressions: number; clicks: number; conversions: number }>>;
  traffic(
    tenantId: string,
    campaignId: string,
    interval: 'minute' | 'hour',
    since: Date,
  ): Promise<Array<{ t: string; segmentKey: string; creativeId: string; decisions: number }>>;
  decision(tenantId: string, decisionId: string): Promise<Record<string, unknown> | null>;
  regret(campaignId: string): Promise<{
    thompson: number;
    uniform: number;
    decisions: number;
    series: Array<{ t: number; thompson: number; uniform: number }>;
  } | null>;
}
