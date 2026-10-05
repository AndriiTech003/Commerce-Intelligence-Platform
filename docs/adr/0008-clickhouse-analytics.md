# 0008. ClickHouse for event analytics

- Status: accepted
- Date: 2026-10-02

## Context

Merchant analytics need revenue and order time series, unique visitors, a four-step conversion funnel,
top products and weekly retention cohorts over months of raw tracking events. Writes are append-only and
arrive in batches. Queries scan many rows but few columns, always filtered by tenant and time.
Running this on the OLTP Postgres would compete with checkout for I/O and buffer cache, and row storage
is a poor fit for wide scans.

## Decision

Use ClickHouse as the analytics store, fed by `apps/stream-worker` (ADR 0010), and queried by the API's
analytics module (`apps/api/src/modules/analytics/infrastructure/clickhouse.store.ts`).

Schema (`infra/clickhouse/migrations`):

- `0001_events.sql` — `events`, `ReplacingMergeTree(received_at)`, partitioned by month of `occurred_at`,
  ordered by `(tenant_id, event_type, toDate(occurred_at), event_id)`, TTL 13 months. Domain events
  (`order.placed`, `order.paid`, refunds) are mapped into the same table as analytics rows.
- `0002_events_per_minute.sql` — `AggregatingMergeTree` with `countState`, `uniqState(profile_id)` and
  `sumState(revenue)`, filled by `mv_events_per_minute`.
- `0003_product_stats_daily.sql` and `0004_campaign_stats_hourly.sql` — `SummingMergeTree` tables with MVs
  for views, add-to-cart, purchases and revenue per product and per campaign/creative/segment.
- `0005_decisions.sql` — `MergeTree` log of personalization decisions, TTL 90 days (written from M5).

Migrations run with a small Node runner (`infra/clickhouse/migrate.mjs`) that keeps a `schema_migrations`
table and applies files in order. It is used by `pnpm infra:setup`, by the integration tests (one throwaway database per run) and by the smoke script.

Queries:

- the funnel uses `windowFunnel(3600)` over `product_viewed → cart_item_added → checkout_started → order_placed`;
- cohorts use `toMonday(min(occurred_at))` per profile and `uniqExact`;
- overview and revenue/order time series read `events FINAL` for exact numbers on small ranges;
- event and visitor time series read `events_per_minute`, top products read `product_stats_daily`;
- results are cached per tenant in Redis for `ANALYTICS_CACHE_SECONDS`.

## Alternatives considered

- **Postgres with partitions or BRIN indexes** — one fewer database, but slow scans at scale, no cheap
  approximate uniques, no `windowFunnel`, and analytics would compete with OLTP load.
- **TimescaleDB** — good for time series with continuous aggregates, but funnels and retention are less natural and it still shares the OLTP instance unless separated.
- **Managed warehouse (BigQuery, Snowflake)** — no ops, but not runnable offline, and latency and pricing do not fit a live dashboard.

## Consequences

- Positive: columnar compression and vectorised scans; funnels and cohorts are single queries.
- Positive: MVs keep dashboard queries cheap without a separate aggregation job.
- Negative: another stateful system to run, back up and migrate. Migrations are forward-only and there is no rollback tooling.
- Negative: deduplication in ReplacingMergeTree is **eventual**: it happens during background merges.
  `FINAL` gives exact results but costs more, so it is used only on bounded ranges.
- Negative, and important: **materialized views fire on insert, before any merge.** A duplicate event that
  gets past the Redis dedupe (ADR 0009) is collapsed in `events` eventually, but is counted twice in
  `events_per_minute` (`countState`, `sumState`), `product_stats_daily` and `campaign_stats_hourly`
  permanently. `uniqState` is unaffected. With Redis healthy this only happens in a narrow crash window,
  but after a Redis data loss the MV-based charts (events per minute, top products) can overcount until
  the affected partitions are rebuilt from `events FINAL`. There is no rebuild job yet; it is a known limitation.
- Negative: no updates or deletes in practice; corrections (refunds) are modelled as new events with negative revenue.
- Revisit when: exact MV numbers become a requirement (then rebuild aggregates from `events FINAL` on a
  schedule), or query concurrency needs a cluster.

## Verification

- `apps/stream-worker/test/integration/pipeline.test.ts` — domain events are mapped into analytics rows;
  duplicates inserted directly collapse in `events` after `OPTIMIZE … FINAL`.
- `apps/api/test/integration/pipeline.test.ts` — a paid order shows up in `/v1/admin/analytics/overview`
  (revenue and order count) and in top products with the right purchase count.
- `scripts/smoke.sh` — sends tracking events, including a duplicate batch, and checks the ClickHouse row counts.
