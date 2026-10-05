# 0007. RabbitMQ (quorum queues) as the message broker, not Kafka

- Status: accepted
- Date: 2026-10-02

## Context

The platform moves two kinds of messages:

- tracking events from the collector: high volume (thousands per second at peak in the target design),
  small, with occasional loss acceptable;
- domain events from the outbox: low volume (tens per second), each one important.

Both fan out to several consumers with different interests (`q.analytics.ingest` takes everything,
`q.notifications` only `order.*` and `inventory.low_stock`, `q.realtime.counters` only `track.#` and
`order.paid`, ...). Consumers need per-message retries, a DLQ and replay of individual failed messages
(ADR 0006). The full event history is stored in ClickHouse anyway (ADR 0008).

## Decision

Use RabbitMQ 4 with durable quorum queues, publisher confirms and topic exchanges.

- Routing by event type with topic bindings, all declared in `packages/contracts/src/topology.ts`.
- Per-message ack/nack, so one slow or failing message does not block a partition.
- Retry and dead-letter built from broker primitives (TTL queues, DLX), with no extra components.
- `packages/messaging` wraps amqplib: confirm channels, `mandatory` publishing with `return` handling
  (unroutable messages are errors), reconnect with backoff, consumer prefetch, graceful shutdown, and
  OpenTelemetry context propagated in headers.
- The collector answers `202` only after the broker confirms. While the broker is unavailable it keeps an
  in-memory buffer (`apps/collector/src/buffer.ts`, gauge `collector_buffer_size`) and answers `503` with `Retry-After` when that buffer is full.

## Alternatives considered

- **Kafka / Redpanda** — higher throughput, durable log, replay from any offset, consumer groups. But
  retries and DLQs must be built on top (retry topics), ordering and parallelism are tied to partition count,
  per-message ack does not exist, and running it locally is heavier. The replay benefit is already
  covered by ClickHouse holding the history.
- **Redis Streams** — already in the stack and light, but persistence and replication are weaker,
  there is no routing, and retries/DLQ are manual (`XPENDING` / `XCLAIM`).
- **Cloud queues (SQS/SNS, Pub/Sub)** — managed, but the project must run fully offline on a laptop.

## Consequences

- Positive: flexible routing and per-message retry semantics with no custom infrastructure.
- Positive: the management UI and API make queues, DLQs and rates visible, which helps the demo.
- Negative: no replay of the whole history from the broker. Messages are deleted after ack. Rebuilding
  ClickHouse aggregates means re-reading ClickHouse (or Postgres for domain data), not the broker.
- Negative: quorum queues keep messages in memory and on disk per replica; a long consumer outage with
  high tracking volume grows memory and needs alerting on queue depth.
- Negative: ordering is per queue and breaks with retries and multiple consumers. Consumers are written to not depend on order.
- Negative: throughput has **not been measured yet**. Load tests (k6) and broker sizing are milestone M6.
- Revisit when: sustained volume is beyond what a small RabbitMQ cluster handles, or a feature needs
  replaying raw events from a point in time (stream processing, reprocessing with new logic).
  RabbitMQ Streams would be the first thing to evaluate before a full move to Kafka.

## Verification

- `packages/messaging/test/integration/messaging.test.ts` — confirms, unroutable detection, retries, DLQ,
  dedupe, batch consumer, graceful shutdown against a real broker.
- `apps/collector/test/integration/collector.test.ts` — accepted events are published to the `track` exchange with confirms.
- `apps/api/test/integration/outbox-durability.test.ts` — no domain event lost while the broker is down.
