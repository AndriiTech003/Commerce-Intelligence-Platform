# 0020. Checkout idempotency: Redis key first, unique index as the second line

- Status: accepted
- Date: 2026-10-02

## Context

`POST /v1/storefront/checkout` creates an order, reserves stock and starts a payment. Clients retry it:
double clicks, mobile networks dropping the response, reverse proxies retrying on timeout. A retried
checkout must return the original order, never create a second one. Concurrent retries arrive while the
first request is still running. Redis is fast but can lose keys (eviction, restart without persistence,
failover); Postgres is durable but cannot hold a response for a request that has not committed yet.

## Decision

Two layers. The `Idempotency-Key` header is required on checkout (400 `IDEMPOTENCY_KEY_REQUIRED` if missing or malformed).

**Layer 1: `IdempotencyInterceptor`** (`apps/api/src/shared/http/idempotency.interceptor.ts`), enabled per route via metadata:

- the Redis key is scoped by tenant and by `sha256(method + route + key)`; the request hash is
  `sha256(method, path, stable-stringified body)`;
- `SET key {state: in_progress, hash} EX 60 NX`. Whoever wins runs the handler;
- on success the entry becomes `{state: done, hash, status, body}` with a 24 h TTL;
- on failure the key is **deleted**, so the client can retry after a 409 for stock or a validation error;
- a request that loses the `SET NX`:
  - different hash → 422 `IDEMPOTENCY_KEY_REUSED`;
  - still `in_progress` → 409 `IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 1`;
  - `done` → the stored status and body, with header `Idempotent-Replayed: true`.

**Layer 2: the database.** `orders` has a unique index `(tenant_id, idempotency_key)`. Inside the checkout
transaction `CheckoutService` first looks up an order with that key and returns it if it exists. If two
transactions race past that lookup (possible when Redis lost the key), the second insert fails with
`23505` on `orders_tenant_idempotency_unique`; the service catches it, reads the existing order in a new
transaction and returns it as a normal success. The losing transaction rolls back its reservations.

## Alternatives considered

- **Database only** (unique key plus a stored-responses table) — durable, but every request, including
  concurrent duplicates, opens a transaction and waits on row locks; responses for in-flight requests cannot be expressed without extra state.
- **Redis only** — fast and simple, but a lost key means a duplicate order, which is exactly what the feature must prevent.
- **Client-side dedupe only** (disable the button) — necessary for UX, but proxies and retries bypass it.

## Consequences

- Positive: the common case (a retry after success) never touches Postgres and replays the exact response.
- Positive: concurrent duplicates fail fast with 409 instead of piling up on row locks.
- Positive: losing Redis does not create duplicate orders.
- Negative: in the Redis-lost case the replay is rebuilt from the order, not byte-identical to the
  original response, and a different body with the same key is no longer detected (the hash lived in Redis).
- Negative: if a handler runs longer than 60 s, the in-progress key expires and a retry can start a second
  run. The unique index still prevents a second order.
- Negative: stored responses live 24 h; a retry after that relies on the unique index only.
- Revisit when: other non-idempotent endpoints need this (refunds, merchant webhooks); they get the same
  interceptor plus their own database constraint.

## Verification

`apps/api/test/integration/checkout.test.ts`:

- "idempotency: 5 parallel requests with one key create one order; another body gets 422" — five
  concurrent checkouts with one key all return 201 with the same order id or 409 `IDEMPOTENCY_IN_PROGRESS`;
  a later retry gets 201 with `Idempotent-Replayed: true`; exactly one row in `orders`; a different body
  with the same key gets 422 `IDEMPOTENCY_KEY_REUSED`; a missing key gets 400.
- "idempotency survives Redis losing the key (unique index fallback)" — after a successful checkout the
  test deletes the Redis keys; the retry returns 201 with the same order id and the table still has one order.
