# 0012. Shopper profile with exponential decay and commutative updates

- Status: accepted
- Date: 2026-10-02

## Context

Every view, search, ad click, cart change and purchase updates the shopper's profile: affinities to category
levels, brands and creative tones, a price estimate, recent and purchased products, sessions, orders and LTV.
Old interest should fade: a shopper who looked at hiking boots two months ago and running shoes yesterday is
a runner now.

The events arrive through RabbitMQ with at-least-once delivery (ADR 0005), from several stream-worker
instances, with retries through TTL queues (ADR 0006). The same profile's events can therefore be processed
out of order, in parallel, and more than once. Tracking events and domain events (`order.placed`) also take
different paths and reach the profile at different times. The profile is read on every decision, so it must
be cheap to read.

## Decision

Keep the live profile as a Redis hash `profile:{tenant}:{profileId}` and make every affinity update a
**commutative** operation on `(score, ts)`, keyed by the event's `occurred_at`, not by processing time.

- **Decay** (`decayAdd` in `packages/personalization/src/profile.ts`, half-life `HALF_LIFE_MS` = 7 days):
  if the event is newer than the stored `ts`, `score = score · 2^(−Δt/7d) + w` and `ts` moves forward; if it is
  older, the stored `ts` stays and the event is folded in with its own decay, `score += w · 2^(−(ts − t)/7d)`.
  Either way the result equals `Σ wᵢ · 2^(−(ts − tᵢ)/7d)`, which does not depend on the order of events.
  Weights: view 1, search 1.5, ad click 2, add to cart 3, purchase 5, remove from cart −1.
- **Atomic update** (`PROFILE_UPDATE_LUA`): one Lua script per profile batch does read, decay, add and write
  for every field. Each event first claims `SET NX` on its `event_id` (48 h TTL), so a redelivered event is
  a no-op. Counters (`orders_count`, `ltv`) use `HINCRBY`, timestamps keep the maximum, sets keep per-item
  maximum timestamps. `apps/stream-worker/src/profiles.ts` groups a consumer batch by profile and runs the
  profiles in parallel; no partitioning by user is needed.
- **Identity stitching** (`PROFILE_MERGE_LUA`): on `customer.identified` the anonymous hash is merged into
  the customer hash with the same decayed sum (`decayMerge`), lists are unioned, and the anonymous key is
  replaced by `{alias: customerId}` with a 30-day TTL. Later events for the anonymous id are redirected to the
  customer inside `PROFILE_UPDATE_LUA`. A second merge sees the alias and does nothing.
- **Snapshots**: every update adds the profile to `profile:dirty:{tenant}`. `PersonalizationJobs` (API,
  `PROFILE_SNAPSHOT_INTERVAL_MS` = 10 min, under a Redis lock) pops dirty ids, computes features and segment
  memberships, and upserts `customer_profiles` in Postgres. The admin, segment previews and recovery after a
  Redis loss read from there.

## Alternatives considered

- **Recompute from history** (ClickHouse query per request or per change) — always exact and trivially
  order-independent, but a query over the shopper's events on every decision does not fit a p95 < 50 ms
  decision budget, and caching it brings back the staleness problem.
- **Partition by user** (consistent-hash routing so one consumer owns a profile, plain sequential updates) —
  order is preserved, but RabbitMQ needs a consistent-hash exchange or many queues, scaling consumers means
  rebalancing, and redeliveries still break order.
- **Sliding-window counters** (e.g. "views in last 30 days") — simple, but a hard cut-off and one bucket per
  window per feature; exponential decay needs one number and one timestamp.

## Consequences

- Positive: consumers scale freely and retries in any order converge to the same affinities. Backfill from
  the simulator with past `occurred_at` produces the same profile as live traffic.
- Positive: no background decay job; decay is applied lazily at read (`decayedScore`) and at write.
- Negative, honest: **the price estimate is not commutative**. `price.ewma_cents` is an EWMA with α = 0.2
  (`current · 0.8 + p · 0.2` in the Lua), so out-of-order events give a slightly different value. It only
  feeds `price.band` and `price_fit`, where a small drift does not change the band; a time-weighted mean
  would fix it at the cost of one more field. On merge, the customer's estimate wins over the anonymous one.
- Negative: the intent score uses a list of timestamped events from the last 30 minutes, not decay. Order
  does not matter, but the list is capped at 100 entries and trimmed by processing time.
- Negative: Redis is the source of truth for up to 10 minutes. Losing Redis loses changes since the last
  snapshot, and the event-dedupe keys expire after 48 h.
- Negative: floating point and the `%.6f` storage format make the sums equal only up to ~1e-6.
- Revisit when: profiles need features that are inherently order-dependent (sequences, "last category
  before purchase"), or Redis memory for profiles (90-day TTL) becomes significant.

## Verification

- `packages/personalization/test/unit/engine.test.ts`:
  - "is commutative: any processing order gives the same score" — fast-check property: random event lists
    (weights incl. −1, times over 60 days), applied in original and shuffled order, give the same decayed
    score within 1e-6;
  - "merging two profiles equals applying all events to one";
  - "halves after one half-life".
- `apps/api/test/integration/personalization.test.ts` runs `PROFILE_UPDATE_LUA` against real Redis:
  shuffled batches give the same hash, a duplicate `event_id` is not applied twice, and a merge redirects
  later anonymous events to the customer.
