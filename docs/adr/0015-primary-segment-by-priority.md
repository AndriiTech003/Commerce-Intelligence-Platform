# 0015. One primary segment by priority as the bandit's partition

- Status: accepted
- Date: 2026-10-02

## Context

Segments are rule sets over profile features (`packages/personalization/src/segments.ts`), and they overlap
by design: a shopper can be `high_intent`, `price_sensitive` and `returning_customer` at the same time, and
also match the merchant's own `runners`. A campaign lists `target_segments`.

The bandit (ADR 0014) keeps independent Beta state per context. If one decision updated several contexts,
the same click would be counted in several bandits, their data would no longer be independent, and the
experiment screen would double-count. Using every _combination_ of segments as a context avoids double
counting, but with 6 system segments plus custom ones the number of combinations grows exponentially and
most of them never get the 50 warm-up impressions per arm, let alone enough to learn.

## Decision

Every decision is attributed to exactly **one** segment, the primary one:

- `primarySegment(memberships, targetSegments)` keeps the shopper's memberships that are among the
  campaign's targets (all memberships if the campaign has no targets) and returns the one with the lowest
  `priority`, ties broken by key. Priorities are explicit numbers on each segment, so the order is visible and
  editable, not an accident of creation time.
- If nothing matches, the decision uses `DEFAULT_SEGMENT = '_default'`, a real bandit context of its own. Cold
  start shoppers therefore still feed a bandit.
- `DecisionService.decide()` (`apps/api/src/modules/campaigns/application/decision.service.ts`) uses the
  primary segment key for the bandit state, the decision record and the explanation. The other matched
  segments are kept in `otherSegments` of the explanation, for transparency only.
- System segments (`SYSTEM_SEGMENTS`): `high_intent` 10, `vip` 20, `lapsed` 30, `price_sensitive` 40,
  `returning_customer` 50, `new_visitor` 60. Demo segments in `apps/api/src/seed-lib.ts`:
  `premium_shoppers` 45, `runners` 70, `hikers` 71. The demo campaign targets `price_sensitive`,
  `premium_shoppers`, `runners` and `hikers`, so the behavioural signal (price) wins over the interest
  signal (category), and interest still separates the rest.

## Alternatives considered

- **A bandit for every intersection of segments** — the most specific context, but the number of contexts
  explodes and each gets too little traffic; most arms would stay in warm-up.
- **Update every matching segment's bandit** — more data per bandit, but one click counted several times,
  correlated estimates and inflated totals on the experiment screen.
- **Contextual bandit over segment memberships as features** — shares statistical strength between
  overlapping audiences, but much more complex to implement and explain (ADR 0014, next step).
- **Pick the most specific segment automatically** (fewest members) — no manual priorities, but the choice
  changes as membership counts change, so a shopper could jump between bandits from one day to the next.

## Consequences

- Positive: contexts are disjoint, each impression and click is counted once, and the per-segment numbers on
  the experiment screen add up to the campaign total (plus holdout).
- Positive: fewer, larger contexts, so arms leave warm-up quickly.
- Positive: the explanation can say exactly which segment and which rules applied.
- Negative: lower-priority segments only see shoppers not claimed by a higher one. With the demo priorities a
  price-sensitive runner is learned as `price_sensitive`, never as `runners`.
- Negative: priorities are a manual choice by the merchant; a bad order hides a useful segment. The admin
  shows member counts per segment to make this visible.
- Negative: a shopper can move between segments as the profile changes (e.g. `intent` drops), so the same
  person contributes to several bandits over time. That is intended: the context is the current state.
- Revisit when: merchants define many overlapping segments, or the primary segment's arms show large CTR
  differences between sub-audiences, which would argue for a contextual model.

## Verification

- `packages/personalization/test/unit/engine.test.ts`, "picks the primary segment by priority among campaign
  targets": a profile in `high_intent`, `price_sensitive` and `returning_customer` gets `price_sensitive` for a
  campaign targeting `returning_customer` and `price_sensitive`, `null` (→ `_default`) for a campaign
  targeting only `vip`, and `high_intent` when the campaign has no targets.
- Every decision record (`decisions` in ClickHouse) stores one `segment_key`; the experiment screen groups by
  it.
