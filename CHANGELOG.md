# Changelog

## M7 — Polish

- AI Insights: aggregates only (no PII) → LLM (Fake by default) → observations that cite their numbers; observations whose numbers do not match the aggregates are dropped; cached 1 h.
- Outgoing merchant webhooks (`order.paid`, `order.refunded`): HMAC `t=…,v1=…` signature, retries 1m/5m/30m/2h/12h, endpoint disabled + owner email after the last failure, delivery log and Resend.
- CSV product import as a background job with progress and a per-row error report.
- Duplicates that slip past the Redis dedupe are checked against ClickHouse before insert, so per-minute and product MVs are no longer double counted.
- "AI creatives" behind the `ai-creatives` flag of `@ashamrai/flags-node` (project 02, vendored tarball) with an offline fallback; Terraform for AWS (validated with OpenTofu); README.public with measured numbers and screenshots.

## M6 — Simulator, load, chaos, observability

- Simulator with `personas.yaml` (hidden tone multipliers), sessions through the real storefront/collector/fake-payment APIs, modes live / run / load / backfill --days=90 / shift, admin control, ground truth vs learned, shadow uniform policy for regret.
- k6 scenarios, chaos scripts against local processes, Prometheus + Grafana (4 dashboards, alert rules) and Jaeger for OTLP traces; decision API hot path optimized after CPU profiling (P(best) cache, dot product on unit vectors).

## M5 — Campaigns, LLM creatives, Thompson sampling

- Campaign CRUD with selector preview, Anthropic and OpenAI-compatible LLM adapters + FakeLlmClient, versioned prompt files, zod-validated structured output with one retry, guardrails, input-hash cache, daily limits and cost/latency/token tracking, review queue with `marketing:approve`.
- Own seeded PRNG + Marsaglia–Tsang Beta sampler, bandit state in Redis via Lua (impression dedupe, warm-up, optional γ), 5-minute snapshots, decision API with full explanations logged to ClickHouse through RabbitMQ, last-click 24 h attribution, 10% holdout, storefront campaign blocks with visibility-based impressions and "Why this?", experiment screen, `pnpm eval:creatives`.

## M4 — Profiles, segments, recommendations

- Redis profiles updated by Lua with 7-day half-life decay (commutative by occurred_at), intent score, price band from ClickHouse quantiles, identity stitching, dirty-set snapshots to Postgres.
- Segment rule engine (all/any, all operators, zod-validated, compiled predicates), system segments, CRUD + preview; product embeddings (hash | local MiniLM server | openai | voyage) with `pnpm reembed`; co-occurrence and popular lists; candidate generation + linear ranking + filters + brand cap + MMR with contributions and a 5-minute cache; storefront For you / Similar / Bought together; admin customer profile and segment builder.

## M3 — Event pipeline and realtime analytics

- `@ashamrai/cip-tracker` browser SDK (batching, sendBeacon, localStorage backup, UUIDv7, Retry-After, consent; 2.11 kB gzip).
- Fastify collector with zod validation, key cache, Redis sliding-window rate limits, GeoIP/device enrichment, confirms and an in-memory buffer with 503 + Retry-After.
- Stream worker: manual ClickHouse batches acked after insert, two-level dedupe, Redis counters/HLL/feed and per-second ticks.
- ClickHouse migrations (events, per-minute/product/campaign MVs, decisions), realtime WebSocket gateway with tickets, admin Live and Analytics pages, DLQ list/peek/replay, Grafana event-pipeline dashboard.

## M2 — Storefront, cart, checkout, orders

- Host-based multi-tenant storefront with ISR + tag revalidation, category filters with cursor infinite scroll, search with suggest, cart merge on login, multi-step checkout with a persisted Idempotency-Key.
- Atomic reservations in variant order, idempotency (Redis + unique index), per-tenant order numbers, FakePaymentProvider + signed idempotent webhooks, Stripe adapter, order state machine, refunds, reservation expiry with a distributed lock.
- Transactional outbox + relay (SKIP LOCKED + LISTEN/NOTIFY), `@cip/messaging` (confirms, return, TTL retry queues, DLQ, poison, dedupe, traceparent, graceful shutdown), topology as code, order emails through the queue.

## M1 — Tenancy, identity, catalog

- Signup/login/refresh rotation with reuse detection, memberships and permission guards, invitations via email, pk_/sk_ API keys, audit log with diffs.
- Categories (ltree), products, variants, inventory, full-text + trigram search, presigned MinIO uploads, OpenAPI + generated client, seed for RunHub and HomeBrew, admin app.

## M0 — Foundation

- pnpm + Turborepo monorepo, zod env validation, pino, Problem Details, health and metrics endpoints, OpenTelemetry bootstrap, Drizzle migrations with FORCE RLS and app_user/app_system roles, dependency boundaries.
