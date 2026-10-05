import type { ClickHouseClient } from '@clickhouse/client';
import type { BatchItem, Deduper } from '@cip/messaging';
import { counter, histogram, SpanKind, withSpan } from '@cip/observability';
import { rowsFor, type PipelineEvent } from './mapping';

export const ANALYTICS_CONSUMER = 'evt';

const inserted = counter('clickhouse_rows_inserted_total', 'Rows inserted into ClickHouse');
const duplicates = counter('analytics_duplicates_total', 'Events dropped by the Redis dedupe before insert');
const insertSeconds = histogram('clickhouse_insert_seconds', 'ClickHouse insert duration');
const verified = counter(
  'analytics_clickhouse_duplicates_total',
  'Events that passed the Redis dedupe but already existed in ClickHouse',
);
const verifySeconds = histogram('clickhouse_dedupe_check_seconds', 'ClickHouse existence check duration');

export class AnalyticsSink {
  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly deduper: Deduper,
    private readonly options: { verifyWithClickHouse?: boolean } = {},
  ) {}

  async existingIds(events: Map<string, PipelineEvent>): Promise<Set<string>> {
    if (events.size === 0) return new Set();
    const tenants = new Set<string>();
    let min = Infinity;
    let max = -Infinity;
    for (const event of events.values()) {
      tenants.add(event.event.tenant_id);
      const t = Date.parse(event.event.occurred_at);
      if (Number.isFinite(t)) {
        min = Math.min(min, t);
        max = Math.max(max, t);
      }
    }
    if (!Number.isFinite(min)) return new Set();
    const timer = verifySeconds.startTimer();
    const result = await this.clickhouse.query({
      query: `SELECT DISTINCT toString(event_id) AS id FROM events
        WHERE tenant_id IN {tenants:Array(UUID)} AND toDate(occurred_at) BETWEEN toDate({from:DateTime64(3, 'UTC')}) AND toDate({to:DateTime64(3, 'UTC')})
          AND occurred_at >= {from:DateTime64(3, 'UTC')} - INTERVAL 1 DAY AND occurred_at <= {to:DateTime64(3, 'UTC')} + INTERVAL 1 DAY
          AND event_id IN {ids:Array(UUID)}`,
      query_params: {
        tenants: [...tenants],
        from: new Date(min - 86_400_000).toISOString().replace('T', ' ').replace('Z', ''),
        to: new Date(max + 86_400_000).toISOString().replace('T', ' ').replace('Z', ''),
        ids: [...events.keys()],
      },
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ id: string }>();
    timer();
    return new Set(rows.map((r) => r.id));
  }

  async handleBatch(items: BatchItem<PipelineEvent>[]): Promise<number> {
    const ids = items.map((i) => i.data.event.event_id);
    const seen = await this.deduper.filterProcessed(ANALYTICS_CONSUMER, ids);
    const unique = new Map<string, PipelineEvent>();
    for (const item of items) {
      const id = item.data.event.event_id;
      if (seen.has(id) || unique.has(id)) {
        duplicates.inc();
        continue;
      }
      unique.set(id, item.data);
    }
    if (this.options.verifyWithClickHouse !== false && unique.size > 0) {
      const existing = await this.existingIds(unique);
      for (const id of existing) {
        if (unique.delete(id)) {
          verified.inc();
          duplicates.inc();
        }
      }
      if (existing.size > 0) await this.deduper.markManyProcessed(ANALYTICS_CONSUMER, [...existing]);
    }
    const rows = [...unique.values()].flatMap(rowsFor);
    if (rows.length > 0) {
      const timer = insertSeconds.startTimer();
      await withSpan(
        'clickhouse insert events',
        { kind: SpanKind.CLIENT, attributes: { 'db.system': 'clickhouse', 'cip.rows': rows.length } },
        () => this.clickhouse.insert({ table: 'events', values: rows, format: 'JSONEachRow' }),
      );
      timer();
      inserted.inc(rows.length);
    }
    await this.deduper.markManyProcessed(ANALYTICS_CONSUMER, [...unique.keys()]);
    return rows.length;
  }
}
