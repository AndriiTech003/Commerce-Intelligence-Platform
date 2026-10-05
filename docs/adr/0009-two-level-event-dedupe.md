# 0009. Two-level deduplication of tracking events: Redis, then ReplacingMergeTree

- Status: accepted
- Date: 2026-10-02

## Context

A tracking event can reach the stream-worker more than once: the browser tracker resends a batch whose
response was lost, the collector republishes from its buffer after a broker hiccup, RabbitMQ redelivers
unacked messages after a worker crash, and a failed ClickHouse insert sends the whole batch through the
retry queues (ADR 0010). Every event carries a client-generated UUIDv7 `event_id`, so duplicates are identifiable.

ClickHouse has no unique constraints. ReplacingMergeTree removes duplicates only during background merges,
so a plain query can see both copies, and materialized views count both at insert time (ADR 0008).

## Decision

Deduplicate at two levels.

**Level 1, Redis, before insert** (`apps/stream-worker/src/analytics-sink.ts`):

1. For the batch, `filterProcessed` checks `EXISTS dedup:evt:{event_id}` for every id in one pipeline.
2. Ids already seen, and repeats of the same id inside the batch, are dropped (`analytics_duplicates_total`).
3. The remaining rows are inserted into `events` in one insert.
4. Only **after** the insert succeeds, `markManyProcessed` sets the keys with a 48 h TTL.

Marking after the insert means a failed insert never hides an event from its retry. The price is a
window: if the worker dies between insert and mark, the redelivered batch is inserted again.

**Level 2, ClickHouse**: `events` is a `ReplacingMergeTree(received_at)` with `event_id` in the sort key,
so whatever slips past Redis (the crash window above, Redis restart or eviction, two workers racing on a
redelivery) collapses on merge. Exact reports read `events FINAL`.

The realtime counters consumer has its own Redis keys (`dedup:rt:{event_id}`) in `claim` mode (ADR 0005), so a
duplicate does not increment the live counters twice.

## Alternatives considered

- **ReplacingMergeTree only** — no Redis dependency, but every query would need `FINAL` and the MVs would
  double count every duplicate, which is the common case for tracker retries.
- **Redis only** — cheap and immediate, but Redis is not durable storage; a flush, eviction or failover
  turns into permanent duplicates in the raw table.
- **`SET NX` claim before insert** — removes the check/mark race, but a failed insert would leave the claim
  set and the retried event would be dropped as a "duplicate", which is data loss.
- **ClickHouse `insert_deduplication_token`** — deduplicates identical retried blocks only, not the same event arriving in different batches.

## Consequences

- Positive: in normal operation each event is inserted once, so MVs and live counters are accurate.
- Positive: the raw table converges to exactly one row per `event_id` even when Redis fails.
- Negative: the window between insert and mark, and a Redis loss, can still produce duplicates in MV
  tables (`events_per_minute`, `product_stats_daily`, `campaign_stats_hourly`), which ReplacingMergeTree
  does not repair. This is documented in ADR 0008 and Known limitations.
- Negative: keys expire after 48 h. Replaying events older than that relies on level 2 only.
- Negative: one extra Redis round trip per batch (pipelined, so cost is per batch, not per event).
- Revisit when: MV exactness matters enough to rebuild aggregates from `events FINAL`, or event volume makes
  the Redis key set (one key per event for 48 h) too large; a Bloom filter or shorter TTL would be options.

## Verification

`apps/stream-worker/test/integration/pipeline.test.ts` against real RabbitMQ, Redis and ClickHouse:

- "dedupes an event sent three times: one ClickHouse row and one Redis increment" — the same event is
  published three times; after `OPTIMIZE TABLE events FINAL` the raw count is 1, and the per-second realtime counter was incremented once;
- "ReplacingMergeTree collapses duplicates that slipped past Redis" — duplicates inserted directly into
  ClickHouse, bypassing Redis, collapse to one row.

`scripts/smoke.sh` sends a batch of five `product_viewed` events to the collector, sends the same batch
again, and checks that `events FINAL` has exactly five `product_viewed` rows for the tenant.
