# 0010. Manual batching in the stream-worker, ack after insert

- Status: accepted
- Date: 2026-10-02

## Context

ClickHouse is built for few large inserts, not many small ones: every insert creates a part, and many tiny
parts lead to merge pressure and eventually "too many parts" errors. Tracking events arrive one message at
a time from RabbitMQ. At the same time a message may only be acked once its row is durably stored, otherwise
a worker crash loses events.

## Decision

Batch in the consumer. `BatchConsumer` (`packages/messaging/src/batch-consumer.ts`), used by
`apps/stream-worker` for `q.analytics.ingest`:

- buffers parsed messages in memory and flushes at **1000 messages or 1 second**, whichever comes first
  (`BATCH_SIZE`, `FLUSH_INTERVAL_MS`);
- flushes are serialised; a full buffer schedules an immediate flush;
- after a successful `handleBatch` (Redis dedupe and one ClickHouse insert, ADR 0009) it acks the whole
  batch with one `ack(last, multiple = true)`;
- if the insert fails, **every** valid message of the batch is published to the retry queue
  (`x-retry-count + 1`, ADR 0006) and then the batch is acked. If even that publish fails, the batch is
  nacked with requeue;
- messages that fail JSON or zod parsing are routed to the DLQ as poison and do not fail the batch;
- the channel prefetch is set to `max(prefetch, batchSize)`. With a prefetch below the batch size the
  batch can never fill and every flush would wait for the timer;
- on shutdown it cancels the consumer, flushes what is buffered (25 s timeout) and closes the channel.

## Alternatives considered

- **ClickHouse `async_insert`** — the server buffers small inserts, so the consumer stays simple. But with
  `wait_for_async_insert = 1` each message waits for the server flush and needs its own insert call; with
  `= 0` the ack happens before the data is durable, so a ClickHouse crash loses acknowledged events. Retry
  and DLQ behaviour per batch would also be harder to control.
- **Buffer table engine** — deprecated in practice, loses data on a crash, and has the same ack problem.
- **External tool (Vector, Kafka engine, ClickPipes)** — robust, but another component, and the dedupe/DLQ logic would be split across systems.

## Consequences

- Positive: at most one insert per second per worker at low volume, 1000-row inserts at high volume.
- Positive: no acked event is lost: ack happens strictly after the insert, and failures go to durable retry queues.
- Negative: we own the batching code (timer, buffer, partial poison, shutdown). It is covered by integration tests.
- Negative: one bad insert retries the whole batch, and its rows may already be partially stored.
  The dedupe (ADR 0009) and ReplacingMergeTree make that safe.
- Negative: up to 1 s added latency on the analytics path. The live dashboard does not depend on it; it is
  fed by the separate `q.realtime.counters` queue.
- Negative: a worker holds up to `prefetch` unacked messages in memory; a crash redelivers them all.
- Revisit when: inserts per second across workers become a merge problem (bigger batches or fewer workers),
  or async inserts with durable acknowledgement become simpler to operate than this code.

## Verification

- `packages/messaging/test/integration/messaging.test.ts` — "batch consumer acks after the batch handler and retries the whole batch on failure".
- `apps/stream-worker/test/integration/pipeline.test.ts` — "routes invalid events to the DLQ as poison",
  plus the end-to-end dedupe and mapping tests that run through the batch consumer.
- Metrics `consumer_batch_size`, `consumer_batch_flushes_total{outcome}` and `clickhouse_insert_seconds`
  are exported on the stream-worker `/metrics` endpoint (port 4150). Throughput numbers come with the M6 load tests.
