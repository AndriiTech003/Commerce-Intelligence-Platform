# 0021. Stock reservations with conditional updates in a fixed lock order

- Status: accepted
- Date: 2026-10-02

## Context

Checkout must never sell more than is on hand, even when a hundred customers buy the last items at the
same moment. A cart can hold several variants, and two carts can hold the same variants in a different
order. Naive "read stock, check in code, write stock" loses updates under concurrency;
`SELECT … FOR UPDATE` on all rows first works but adds a round trip per line and still deadlocks if two
transactions lock the same rows in a different order.

Unpaid orders hold stock. If the customer never pays, the reservation must be released, exactly once,
even with several domain-worker instances running.

## Decision

**Atomic conditional update per line** (`inventory/infrastructure/inventory.repository.ts`):

```sql
update inventory_items set reserved = reserved + $q
where variant_id = $v and on_hand - reserved >= $q
returning variant_id;   -- 0 rows = not enough stock
```

The row lock is taken by the update itself; check and write are one statement. If any line returns
0 rows, the service collects all shortages and throws `InsufficientStockError` (409 `INSUFFICIENT_STOCK` with
`variantId`, `requested`, `available` per line), and the whole checkout transaction rolls back.

**Deterministic lock order.** `lockOrder()` in `apps/api/src/modules/inventory/domain/inventory.ts` merges
duplicate lines and sorts by `variant_id`. Reserve, release, commit and restock all go through it, so two
transactions always lock shared rows in the same order and cannot deadlock on inventory.

**The per-tenant order counter is locked last.** The human-readable order number comes from
`tenant_counters` (`insert … on conflict do update set value = value + 1 returning value`), which is a hot
row for the whole tenant. `OrderService.place()` runs it after all reservations, so the counter lock is
held only for the end of the transaction, and checkouts that fail on stock never touch it.

**Database invariant as a backstop**: `inventory_items` has `check (reserved >= 0)`, `check (on_hand >= 0)`
and `check (reserved <= on_hand)`. A bug in application code fails the transaction instead of overselling.

**Reservation expiry** (`apps/domain-worker/src/jobs/reservation-expiry.ts`): every 30 s, under a Redis
lock, the worker finds active reservations past `expires_at` (15 minutes by default) whose order is still
`pending_payment`. For each order, in a tenant-scoped transaction, it locks the order row, rechecks the
status, releases the reserved quantities in `variant_id` order, cancels the order (`payment_timeout`),
gives back the discount usage, fails the pending payment and writes `order.cancelled` to the outbox.
The lock (`apps/domain-worker/src/lock.ts`) is `SET key token NX PX ttl`, released with a Lua
compare-and-delete so an instance never releases a lock that expired and was taken by another one.

## Alternatives considered

- **`SELECT … FOR UPDATE` then update** — explicit, but two round trips per line and the same deadlock risk without ordering.
- **Serializable isolation with retries** — correct, but under contention most transactions abort and retry, which wastes work and makes latency unpredictable.
- **Redis counters for stock** — fast, but stock would no longer be in the same transaction as the order, which brings back the dual-write problem.
- **Postgres advisory lock for expiry instead of Redis** — would also work; Redis was chosen because the same lock helper also guards outbox cleanup and other non-database jobs.

## Consequences

- Positive: no overselling and no inventory deadlocks, with one statement per line.
- Positive: the order row re-check makes expiry idempotent even if the Redis lock fails (two workers cannot cancel the same order twice).
- Negative: a very popular variant is a hot row; all checkouts for it serialise on its lock. Fine for this
  scale; flash sales would need sharded stock rows or a queue in front of checkout.
- Negative: the Redis lock is a best-effort mutex (no fencing tokens). Correctness relies on the row lock and status check, not on the Redis lock.
- Negative: reserved stock is unavailable for up to 15 minutes plus one expiry interval after an abandoned checkout.
- Revisit when: one variant's contention shows up in latency, or reservations need partial release.

## Verification

- `apps/api/test/integration/checkout.test.ts`:
  - "no overselling: 100 concurrent checkouts on stock 10 produce exactly 10 orders" — 10 × 201, 90 × 409
    `INSUFFICIENT_STOCK`, `on_hand = 10, reserved = 10`, 10 distinct order numbers;
  - "no deadlock when carts contain the same two items in reverse order" — 40 concurrent carts on two
    variants with stock 30 each; every request is 201 or 409, exactly 30 orders, both variants end at `reserved = 30`;
  - "expires reservations: the worker releases stock and cancels unpaid orders once".
- `apps/domain-worker/test/integration/lock.test.ts` — exactly one of many concurrent workers runs the job;
  a lock owned by someone else is never released; locks expire.
- `apps/api/test/unit/domain.test.ts` — `lockOrder` sorts deterministically and merges duplicates.
