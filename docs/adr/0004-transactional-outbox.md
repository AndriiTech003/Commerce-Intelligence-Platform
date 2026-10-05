# 0004. Transactional outbox with a SKIP LOCKED relay and LISTEN/NOTIFY

- Status: accepted
- Date: 2026-10-02

## Context

Domain events (`order.placed`, `order.paid`, `order.cancelled`, `inventory.low_stock`, ...) drive emails,
analytics revenue and realtime counters. They must not be lost. "Commit the order, then publish to
RabbitMQ" has two failure windows: the process can die between commit and publish, and the broker can be
down at commit time. Publishing before commit is worse: consumers can see an event for an order that is
then rolled back.

## Decision

Write the event into an `outbox` table **in the same transaction** as the state change, and publish it later.

- Writer: `apps/api/src/modules/outbox` (`DrizzleOutboxWriter`). It validates the payload with the zod
  schema from `packages/contracts`, captures the current `traceparent`, and inserts through `db.tx()`,
  which throws if there is no surrounding transaction. An event cannot be written outside the business transaction.
- Wake-up: the trigger `outbox_notify` (migration `0002_rls_roles_outbox.sql`) calls `pg_notify('outbox', '')`
  per insert statement. The relay holds `LISTEN outbox` and wakes immediately; without notifications it
  polls every 200 ms.
- Relay: `packages/messaging/src/outbox-relay.ts`, run by `apps/domain-worker` with the `app_system` role.
  Each iteration: `BEGIN`; `select … from outbox where published_at is null order by created_at limit 100
  for update skip locked`; publish every row to the `domain` exchange (routing key = event type,
  `messageId` = outbox id) with publisher confirms; mark rows published; `COMMIT`.
- Failure handling: after a failed iteration the relay backs off exponentially (200 ms, doubling, capped at
  5 s by default) instead of hammering a broker that is down.
- Retention: published rows older than 7 days are deleted hourly (`cleanup()`, under a Redis lock).

**Deviation from the original design** (`docs/04-events-and-messaging.md` said "if publish fails, roll the
transaction back"): on a partial failure the relay commits the rows that were confirmed as
`published_at = now()` and only increments `attempts` and sets `last_error` for the failed ones. Rolling back
the whole batch would republish the rows the broker already accepted, which creates duplicates.
Consumers are idempotent anyway (ADR 0005), but there is no reason to create duplicates on purpose.

## Alternatives considered

- **Publish after commit** — simple, but loses events on a crash or broker outage between commit and publish.
- **CDC with Debezium (logical decoding)** — no polling and strict commit order, but Kafka Connect or
  Debezium Server, replication slots and their monitoring are heavy for this project.
- **Two-phase commit between Postgres and the broker** — RabbitMQ does not take part in XA; not an option.

## Consequences

- Positive: an event exists if and only if its transaction committed. Broker outages delay events and never drop them.
- Positive: `SKIP LOCKED` lets several relays run in parallel without double publishing a row that is locked.
- Positive: the `traceparent` stored in headers continues the trace from the HTTP request to the consumers.
- Negative: delivery is at-least-once. A crash after the broker confirms but before `COMMIT` republishes the batch.
  Consumers dedupe by message id (ADR 0005).
- Negative: order is only approximate (`created_at`, parallel publishes). Consumers check state
  transitions instead of relying on order.
- Negative: a single relay is a throughput bottleneck and adds write amplification (insert + update + delete per event).
  Partitioning by `tenant_id` or moving to CDC is the next step when this shows in metrics
  (`outbox_oldest_unpublished_seconds`). This is listed in Known limitations.
- Revisit when: outbox lag grows under load, or event volume needs strict ordering per aggregate.

## Verification

`apps/api/test/integration/outbox-durability.test.ts` stops RabbitMQ (`brew services stop rabbitmq`,
configurable through `RABBITMQ_STOP_CMD` / `RABBITMQ_START_CMD`), places 20 orders through the HTTP API
(all return 201), asserts that 20 `order.placed` rows are unpublished, starts a relay against the stopped
broker and checks that the rows are still unpublished after it has tried, restarts the broker, waits for the outbox to drain, and then checks that a probe queue received
**exactly 20 distinct** `order.placed` messages for those orders and nothing more.
