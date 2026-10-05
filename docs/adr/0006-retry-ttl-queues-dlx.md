# 0006. Retries through TTL queues and a dead-letter exchange

- Status: accepted
- Date: 2026-10-02

## Context

Consumers fail for two different reasons. Transient failures (ClickHouse busy, SMTP timeout, a deadlock)
should be retried with a delay, not in a hot loop. Poison messages (invalid JSON, schema violations) will
never succeed and must not block the queue or burn retries. Failed messages must be inspectable and
replayable after a fix.

All queues are quorum queues for durability. RabbitMQ's `delayed-message` plugin is not replicated with
quorum queues and is not in the standard image.

## Decision

Delays are built with plain queues: per-message TTL plus dead-lettering.

- Exchanges: `track`, `domain` (topic); `retry` and `dlx` (direct).
- For each logical queue `<name>` (`analytics.ingest`, `realtime.counters`, `notifications`, ...):
  - `q.<name>` — quorum, `x-delivery-limit: 10` as a safety net, dead-letters to `dlx`;
  - `q.<name>.retry.5s`, `.retry.30s`, `.retry.5m` — quorum, `x-message-ttl`, dead-letter to the default
    exchange with routing key `q.<name>`, so an expired message goes back to the main queue;
  - `q.<name>.dlq` — bound to `dlx` with routing key `<name>`.
- Failure routing (`packages/messaging/src/failure.ts`): a retryable error publishes the message to
  `retry` with the next delay and `x-retry-count + 1`, then acks the original. After the last step, or for a
  poison error, it publishes to `dlx` with `x-error`, `x-error-kind`, `x-original-queue` and `x-failed-at`.
  If publishing the failure fails, the original is nacked with requeue.
- Classification (`errors.ts`): `PoisonMessageError` and `ZodError` are poison and go straight to the DLQ;
  everything else is retryable.
- DLQ tooling: `DlqAdmin` (`packages/messaging/src/dlq.ts`) lists DLQs, peeks messages and replays all or
  selected ids back to `q.<name>` with the retry count reset. It is exposed to platform admins via
  `/v1/platform/dlq` and the admin UI.
- DLQs use `x-delivery-limit: -1`. Peeking uses `basic.get` without ack and then returns the messages; on a
  quorum queue every return counts as a delivery, and with a finite limit repeated peeks would eventually drop messages.
- Topology as code: `packages/contracts/src/topology.ts` is the single source.
  `infra/rabbitmq/generate.mjs` renders `infra/rabbitmq/definitions.json`, and `scripts/rabbitmq-apply.mjs`
  (via `infra/rabbitmq/apply.mjs`) applies it through the management HTTP API to vhost `cip`.
  Applications never declare topology; they only `checkQueue` on start.

## Alternatives considered

- **`rabbitmq_delayed_message_exchange` plugin** — arbitrary delays, but no quorum replication and an extra plugin.
- **In-memory retries in the consumer** — simplest, but holds prefetch slots, blocks the queue and
  loses the retry state on restart.
- **`nack` with requeue** — immediate hot loop and, on quorum queues, quickly hits the delivery limit.

## Consequences

- Positive: retries survive consumer restarts and broker restarts (all queues are durable quorum queues).
- Positive: poison messages cost one hop, not four.
- Positive: topology is reviewed in code and identical in dev, tests (throwaway vhosts) and smoke runs.
- Negative: delays are fixed steps (5 s / 30 s / 5 m) and there are four extra queues per logical queue.
- Negative: a retried message goes to the back of the main queue, so retries do not keep order.
- Negative: a per-queue TTL only expires messages at the head. This is fine because each retry queue has one fixed TTL.
- Revisit when: arbitrary per-message delays are needed, or queue count becomes an operational issue.

## Verification

`packages/messaging/test/integration/messaging.test.ts` against a real RabbitMQ with a throwaway vhost:

- "retries a failing handler and processes it once with x-retry-count = 2";
- "sends poison messages straight to the DLQ and replays them after a fix";
- "publishes with confirms and rejects unroutable messages (mandatory + return)".

`packages/messaging/test/unit/failure.test.ts` walks the retry ladder to the DLQ.
`apps/api/test/integration/pipeline.test.ts` lists, peeks and replays DLQ messages through the platform API.
