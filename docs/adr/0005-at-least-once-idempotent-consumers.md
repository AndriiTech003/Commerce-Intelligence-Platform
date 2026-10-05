# 0005. At-least-once delivery with idempotent consumers

- Status: accepted
- Date: 2026-10-02

## Context

Every hop in the pipeline can redeliver: the outbox relay can republish after a crash (ADR 0004), RabbitMQ
redelivers unacked messages when a consumer dies, the retry ladder republishes failed messages (ADR 0006),
and the browser tracker resends a batch when a response is lost. RabbitMQ does not offer exactly-once
delivery, and no broker can make an external side effect (an email, an `INCR`) exactly-once by itself.

Not all effects are equally valuable. A duplicate "payment received" email is visible to a customer; a
duplicate live-counter increment is a cosmetic error that disappears in a few minutes.

## Decision

Accept at-least-once delivery everywhere and make each consumer idempotent, keyed by the message id
(`event_id` for tracking events, outbox row id for domain events). The guarantee is chosen per consumer:

- **Redis dedupe** for tracking consumers: `RedisDeduper` (`packages/messaging/src/dedupe.ts`) with keys
  `dedup:{consumer}:{id}` and a 48 h TTL. The generic `Consumer` supports two modes:
  - `after` (default): check `EXISTS`, run the handler, then `SET … NX`. A crash between effect and mark
    repeats the effect, so the handler should be naturally idempotent.
  - `claim`: `SET NX` before the handler. Used by `realtime.counters` in `apps/stream-worker/src/worker.ts`,
    where double counting is worse than missing a tick. A failed handler is not retried effectively, so it is at-most-once for that effect.
- **Postgres `processed_messages`** for the notifications consumer (`apps/domain-worker/src/notifications/handler.ts`):
  `insert into processed_messages (consumer, message_id) … on conflict do nothing returning` runs in the
  **same transaction** as the handler's database reads. If the row already exists, the message is acked
  and nothing is sent. If the handler throws, the transaction (and the claim) rolls back and the retry runs again.
- **In-process serialisation**: `Consumer` keeps an `inFlightIds` map, so concurrent deliveries of the same
  message id inside one process run one after another and the second sees the first one's mark.

The analytics sink uses the same Redis keys in batch form, plus ReplacingMergeTree as a second level (ADR 0009).

## Alternatives considered

- **Exactly-once broker semantics** (Kafka transactions) — only covers broker-to-broker flows; side effects
  in Postgres, Redis or SMTP still need idempotency. Would also mean switching brokers (ADR 0007).
- **Postgres inbox for every consumer** — strongest, but a write per tracking event into Postgres at
  thousands of events per second is the wrong cost for counters.
- **Redis dedupe for everything** — cheap, but Redis can lose keys (eviction, failover) and is not in
  the same transaction as the database effect.

## Consequences

- Positive: database effects of domain consumers are effectively-once. Tracking consumers pay one Redis round trip per message or batch.
- Negative: the email itself is outside the transaction. If SMTP accepts the message and the commit then
  fails, the retry sends a second email. That window is small and accepted. A provider-side idempotency key
  would close it with a real email provider.
- Negative: Redis `after` mode has a check-then-act gap between processes. Two instances receiving the same
  redelivered message at the same moment can both apply it. Serialisation only covers one process.
- Negative: dedupe keys expire after 48 h; a replay of older messages is processed again. DLQ replays
  normally happen well within that window.
- Revisit when: a consumer gains a costly, non-idempotent external effect (payments, webhooks to merchants);
  it gets a Postgres inbox or a provider idempotency key.

## Verification

- `packages/messaging/test/integration/messaging.test.ts` — "dedupes redelivered messages with Redis".
- `apps/api/test/integration/pipeline.test.ts` — after a real paid order sends one email, the test
  republishes the same `order.paid` message id directly to RabbitMQ and asserts Mailpit still has exactly
  **one** email and `processed_messages` has one row for that id.
- `apps/stream-worker/test/integration/pipeline.test.ts` — the same event published three times produces one
  ClickHouse row and one Redis counter increment.
