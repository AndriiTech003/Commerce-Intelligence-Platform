# Load tests (k6) and chaos scripts

## Quick start

```sh
scripts/observability.sh start                      # Prometheus :4191, Grafana :4192, Jaeger :4193 (OTLP :4194)
RATE_LIMIT_PER_KEY=1000000 RATE_LIMIT_BURST=2000000 STACK_CHAOS=1 \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4194 node scripts/stack.mjs smoke   # in another terminal
eval "$(node scripts/loadtest-env.mjs smoke)"       # exports API_URL, COLLECTOR_URL, TRACKING_KEY, TENANT_ID, …
SUMMARY=.observability/k6/collector-ramp.json k6 run infra/k6/collector-ramp.js
```

`node scripts/loadtest-env.mjs dev|smoke|e2e` reads `.smoke/<profile>.json` (or the dev ports), logs in as
`owner@<store>.dev` and prints the store's tracking key and tenant id. Every script also resolves the tracking
key itself in `setup()` when `TRACKING_KEY` is not set. The collector limits each tracking key to
`RATE_LIMIT_PER_KEY` events/s (default 1000, burst 2000): raise it when starting the stack for ingest tests,
otherwise the scripts count `rate_limited_429`.

`pnpm loadtest` (`k6 run infra/k6/collector-ramp.js`) still works with the defaults against the dev ports.

Each script prints a compact summary and, when `SUMMARY=<path>` is set, writes a JSON report (throughput,
p50/p90/p95/p99/max, error rate, thresholds, custom counters) through `handleSummary`.

## Common variables

| Variable | Default | Meaning |
|---|---|---|
| `API_URL` | `http://127.0.0.1:4100` | API base URL |
| `COLLECTOR_URL` | `http://127.0.0.1:4110` | Collector base URL |
| `STORE` | `runhub` | Store slug (`x-store`) |
| `TRACKING_KEY` | resolved via login | Publishable `pk_live_…` key of the store |
| `TENANT_ID` | resolved via login | Tenant id (reported in summaries) |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | `owner@<store>.dev` / `demo1234` | Used to resolve the tracking key |
| `SUMMARY` | — | Path of the JSON summary |
| `PRE_VUS` / `MAX_VUS` | per script | VU pool of arrival-rate executors |

## Scenarios

| Script | What it measures | Specific variables (default) | Thresholds |
|---|---|---|---|
| `collector-ramp.js` | `POST /v1/events` with batches of `BATCH` events, `ramping-arrival-rate` from `START_RATE` to `MAX_RATE` batches/s, aborts at the first threshold failure (= ramp until failure) | `BATCH` (20), `START_RATE` (10), `MAX_RATE` (500), `RAMP` (2m), `HOLD` (30s), `ABORT_ON_FAIL` (1) | p95 < 100 ms, 0 % errors |
| `pipeline-e2e.js` | Constant collector load, then freshness: `message_end_to_end_seconds{queue}` scraped from the stream-worker `/metrics` before and after the run (delta histogram → p50/p95/p99); optionally the same p95 from Prometheus | `RATE` (50 batches/s), `BATCH` (20), `DURATION` (2m), `DRAIN_SECONDS` (10), `QUEUE` (q.analytics.ingest), `STREAM_METRICS_URL` (`:4150/metrics`), `PROMETHEUS_URL` (—), `EVENT_MIX` (`page` or `product`), `RETRIES` (0, SDK-style backoff on 429/5xx), `RUN_ID` (session id stamped on every event), `FRESHNESS_P95_TARGET` (2 s) | freshness p95 < 2 s, errors < 0.1 % |
| `checkout-contention.js` | `VUS` buyers, no think time, each: add a random variant from a pool of `PRODUCTS` products to a new cart, checkout with a fresh `Idempotency-Key`; 5 % replay the key | `VUS` (200), `PRODUCTS` (20), `DURATION` (1m), `REPLAY_SHARE` (0.05) | 0 × 5xx, ≥ 1 order |
| `decision-api.js` | `GET /v1/storefront/decisions?placement=…` over `PROFILES` anonymous ids; `WARM_SHARE` of them get 5 `product_viewed` events in `setup()` | `PROFILES` (2000), `WARM_SHARE` (0.3), `WARM` (1), `WARM_WAIT_SECONDS` (5), `PLACEMENT` (home_hero), `RATE` (100/s), `DURATION` (1m) | p95 < 50 ms, errors < 0.1 % |
| `storefront-browse.js` | Mixed storefront API: 30 % catalog list, 30 % product, 15 % search suggest, 25 % recommendations (for_you / similar / bought_together) | `RATE` (50/s), `DURATION` (1m), `PRODUCTS` (96) | p95 < 200 ms overall and per route |

`checkout-contention` buys real stock: run it on a throwaway stack (`smoke`), not on the dev database.
Counters in its summary: `orders_created_201`, `checkout_conflict_409`, `checkout_5xx`, `cart_add_failed`,
`cart_conflict_409`, `idempotent_replays`.

Freshness is read from the stream-worker histogram directly (it covers every message of the queue during the run, so
concurrent traffic such as the simulator is included), so no Prometheus is required; with
`PROMETHEUS_URL=http://127.0.0.1:4191` the summary also contains
`histogram_quantile(0.95, increase(message_end_to_end_seconds_bucket[run]))` for comparison.

## Chaos scripts (`infra/chaos`)

They need a stack started with `STACK_CHAOS=1` (a killed service is logged instead of tearing the stack down;
`scripts/stack-ctl.mjs <profile> kill|stop|start|restart|status|pid <service> [KEY=VALUE…]` restarts a single
service with the stack's command and environment). `PROFILE` selects the stack (default `smoke`). Every script
restores what it broke in an `EXIT` trap, prints `RESULT: scenario | expectation | observed | PASS/FAIL` and
appends a row to `infra/chaos/results.md`; raw k6 output and summaries go to `.observability/chaos/<run>/`.

| Script | What it does | Pass condition |
|---|---|---|
| `kill-stream-worker.sh` | `pipeline-e2e` load (`RATE`=25×20 ev/s, `DURATION`=60s), `kill -9` the stream-worker after `KILL_AFTER`=20 s, start it after `DOWN_SECONDS`=10 s | events accepted == `count()` FROM events FINAL for the run's session id == unique event ids, DLQ empty |
| `rabbitmq-down.sh` | load with `RETRIES`=6, `brew services stop rabbitmq` for `DOWN_SECONDS`=60, places `ORDERS`=10 orders while it is down, restarts the broker (also in the trap) | all orders created (201), outbox drained, every `order_placed` delivered to ClickHouse, tracked events accepted == stored |
| `clickhouse-down.sh` | load, `kill -STOP` the ClickHouse server for `PAUSE_SECONDS`=120, then `kill -CONT` (also in the trap). Freezing simulates an unreachable ClickHouse without killing the shared devinfra server; note it pauses ClickHouse for every local project for that time | backlog grew, then drained to 0, DLQ empty, counts match |
| `redis-flush.sh` | `decision-api` load with warmed profiles, then deletes the stack's `REDIS_PREFIX*` keys in db 1 (`MODE=flushdb CONFIRM_FLUSHDB=1` runs `FLUSHDB` on db 1 instead; other dbs are never touched), replays a checkout with the same `Idempotency-Key` | decision API error rate 0, exactly one order with that key (unique index) |
| `slow-consumer.sh` | restarts the stream-worker with `CHAOS_DELAY_MS`=`DELAY_MS` (200), drives `RATE`=75×20 ev/s (needs the raised per-key rate limit), waits for the Grafana/Prometheus lag alert, restores | `q.realtime.counters` depth > 500, alert `Consumer lag: queue backlog growing` / `CipQueueBacklogGrowing` firing, queue drained after restore |
