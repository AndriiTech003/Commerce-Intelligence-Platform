import type { ClickHouseClient } from '@clickhouse/client';
import { decisionMadeSchema, type DecisionMade } from '@cip/contracts';
import { PoisonMessageError, type BatchItem, type Deduper } from '@cip/messaging';
import { counter, SpanKind, withSpan } from '@cip/observability';
import { chDateTime } from './mapping';

const inserted = counter('decisions_logged_total', 'Decisions written to ClickHouse');

export function parseDecision(raw: unknown): DecisionMade {
  const parsed = decisionMadeSchema.safeParse(raw);
  if (!parsed.success) throw new PoisonMessageError(parsed.error.issues[0]?.message ?? 'invalid decision');
  return parsed.data;
}

const ZERO = '00000000-0000-0000-0000-000000000000';

export function decisionRow(d: DecisionMade) {
  return {
    decision_id: d.decision_id,
    tenant_id: d.tenant_id,
    placement: d.placement,
    profile_id: d.profile_id,
    segment_key: d.segment_key,
    campaign_id: d.campaign_id ?? ZERO,
    creative_id: d.creative_id ?? ZERO,
    product_ids: d.product_ids,
    sampled_scores: d.sampled_scores,
    explanation: JSON.stringify(d.explanation),
    decided_at: chDateTime(d.decided_at),
    policy: d.policy,
  };
}

export class DecisionSink {
  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly deduper: Deduper,
  ) {}

  async handleBatch(items: BatchItem<DecisionMade>[]): Promise<void> {
    const ids = items.map((i) => i.data.decision_id);
    const seen = await this.deduper.filterProcessed('decisions', ids);
    const unique = new Map<string, DecisionMade>();
    for (const item of items)
      if (!seen.has(item.data.decision_id)) unique.set(item.data.decision_id, item.data);
    const rows = [...unique.values()].map(decisionRow);
    if (rows.length > 0) {
      await withSpan(
        'clickhouse insert decisions',
        { kind: SpanKind.CLIENT, attributes: { 'db.system': 'clickhouse', 'cip.rows': rows.length } },
        () => this.clickhouse.insert({ table: 'decisions', values: rows, format: 'JSONEachRow' }),
      );
      inserted.inc(rows.length);
    }
    await this.deduper.markManyProcessed('decisions', [...unique.keys()]);
  }
}
