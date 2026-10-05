#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STOP_CMD="${RABBITMQ_STOP_CMD:-brew services stop rabbitmq}"
START_CMD="${RABBITMQ_START_CMD:-brew services start rabbitmq}"
DOWN_SECONDS="${DOWN_SECONDS:-60}"
RATE="${RATE:-10}"
ORDERS="${ORDERS:-10}"
SETTLE_TIMEOUT="${SETTLE_TIMEOUT:-240}"
MGMT="${RABBITMQ_MANAGEMENT_URL:-http://127.0.0.1:15672}"

load_env
RUN_ID="$(uuid)"
BROKER_STOPPED=0

broker_up() {
  curl -sf -m 3 -u "${RABBITMQ_MANAGEMENT_AUTH:-guest:guest}" "$MGMT/api/vhosts/$RABBITMQ_VHOST" >/dev/null 2>&1
}

start_broker() {
  if [[ "$BROKER_STOPPED" == 1 ]] || ! broker_up; then
    log "starting RabbitMQ: $START_CMD"
    $START_CMD || true
    BROKER_STOPPED=0
    wait_until 180 "RabbitMQ management API" broker_up || log "WARNING: RabbitMQ did not come back, run: $START_CMD"
  fi
}

restore() {
  stop_load
  start_broker
}
trap restore EXIT INT TERM

broker_up || { echo "chaos: RabbitMQ is not running" >&2; exit 2; }
LOAD_SECONDS=$((DOWN_SECONDS + 60))
start_load pipeline-e2e RATE="$RATE" DURATION="${LOAD_SECONDS}s" RUN_ID="$RUN_ID" RETRIES="${RETRIES:-6}" DRAIN_SECONDS=1 FRESHNESS_P95_TARGET=100000
sleep 15

log "stopping RabbitMQ for ${DOWN_SECONDS}s: $STOP_CMD"
BROKER_STOPPED=1
$STOP_CMD
sleep 5
ORDERS_JSON="$(h orders "$ORDERS")"
echo "$ORDERS_JSON" >"$WORK/orders.json"
CREATED="$(node -e 'console.log(JSON.parse(process.argv[1]).created)' "$ORDERS_JSON")"
log "orders created while the broker is down: $CREATED / $ORDERS"
OUTBOX_LAG="$(h metric "$DOMAIN_METRICS_URL" outbox_oldest_unpublished_seconds || true)"
BUFFER_MAX=0
for _ in $(seq 1 $(((DOWN_SECONDS - 5) / 5))); do
  b="$(h metric "$COLLECTOR_METRICS_URL" collector_buffer_size || echo 0)"
  b="${b%.*}"
  ((${b:-0} > BUFFER_MAX)) && BUFFER_MAX="${b:-0}"
  sleep 5
done
OUTBOX_LAG="$(h metric "$DOMAIN_METRICS_URL" outbox_oldest_unpublished_seconds || echo "$OUTBOX_LAG")"
log "collector buffer peak $BUFFER_MAX, oldest unpublished outbox row ${OUTBOX_LAG}s"

start_broker
wait_load pipeline-e2e

UNPUBLISHED() {
  psql "$DATABASE_ADMIN_URL" -tAc "select count(*) from outbox where published_at is null"
}
outbox_drained() {
  [[ "$(UNPUBLISHED)" -eq 0 ]]
}
wait_until "$SETTLE_TIMEOUT" "outbox drained" outbox_drained || true
IDS="$(node -e 'console.log(JSON.parse(process.argv[1]).ids.map((i) => `'"'"'${i}'"'"'`).join(","))' "$ORDERS_JSON")"
placed_delivered() {
  local n
  [[ -z "$IDS" ]] && return 0
  n="$(h ch "SELECT uniqExact(order_id) FROM events FINAL WHERE tenant_id = '$TENANT_ID' AND event_type = 'order_placed' AND order_id IN ($IDS)")"
  log "order_placed delivered to analytics: $n / $CREATED"
  [[ "$n" -ge "$CREATED" ]]
}
wait_until "$SETTLE_TIMEOUT" "order_placed events delivered" placed_delivered || true
DELIVERED="$( [[ -z "$IDS" ]] && echo 0 || h ch "SELECT uniqExact(order_id) FROM events FINAL WHERE tenant_id = '$TENANT_ID' AND event_type = 'order_placed' AND order_id IN ($IDS)")"
ACCEPTED="$(h summary "$WORK/pipeline-e2e.json" eventsAccepted)"
LOST_BATCHES="$(h summary "$WORK/pipeline-e2e.json" batchesLost)"
R503="$(h summary "$WORK/pipeline-e2e.json" custom.unavailable_503.count)"
tracked_stored() {
  [[ "$(ch_run_count "$RUN_ID")" -ge "${ACCEPTED:-0}" ]]
}
wait_until 120 "tracked events stored" tracked_stored || true
STORED="$(ch_run_count "$RUN_ID")"
PENDING="$(UNPUBLISHED)"
STATUS=FAIL
if [[ "$CREATED" -eq "$ORDERS" && "$DELIVERED" -eq "$CREATED" && "$PENDING" -eq 0 && "$STORED" -ge "${ACCEPTED:-0}" ]]; then
  STATUS=PASS
fi
report "rabbitmq-down" \
  "broker stopped ${DOWN_SECONDS}s: collector buffers then 503, SDK retries; orders still created (outbox); all domain events delivered after restart" \
  "orders $CREATED/$ORDERS created, order_placed delivered $DELIVERED/$CREATED, outbox unpublished $PENDING, outbox lag peak ${OUTBOX_LAG:-?}s, collector buffer peak $BUFFER_MAX, 503s ${R503:-0}, tracking accepted $ACCEPTED stored $STORED, batches lost after ${RETRIES:-6} retries ${LOST_BATCHES:-0}" \
  "$STATUS"
[[ "$STATUS" == PASS ]]
