#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

RATE="${RATE:-25}"
DURATION="${DURATION:-60s}"
KILL_AFTER="${KILL_AFTER:-20}"
DOWN_SECONDS="${DOWN_SECONDS:-10}"
SETTLE_TIMEOUT="${SETTLE_TIMEOUT:-180}"

load_env
require_chaos_stack
RUN_ID="$(uuid)"

restore() {
  stop_load
  if [[ -z "$(node "$STACK_CTL" "$PROFILE" pid stream-worker)" ]]; then
    log "restore: starting stream-worker"
    node "$STACK_CTL" "$PROFILE" start stream-worker || true
  fi
}
trap restore EXIT INT TERM

start_load pipeline-e2e RATE="$RATE" DURATION="$DURATION" RUN_ID="$RUN_ID" DRAIN_SECONDS=1 EVENT_MIX=product FRESHNESS_P95_TARGET=1000
sleep "$KILL_AFTER"
log "kill -9 stream-worker"
node "$STACK_CTL" "$PROFILE" kill stream-worker
sleep "$DOWN_SECONDS"
log "backlog while the worker is down: $(h queue q.analytics.ingest) messages in q.analytics.ingest"
node "$STACK_CTL" "$PROFILE" start stream-worker
wait_load pipeline-e2e

SENT="$(h summary "$WORK/pipeline-e2e.json" eventsAccepted)"
SENT="${SENT:-0}"
log "events accepted by the collector: $SENT (run $RUN_ID)"
stored_matches() {
  local n
  n="$(ch_run_count "$RUN_ID")"
  log "ClickHouse FINAL count $n / $SENT, backlog $(h backlog)"
  [[ "$n" -ge "$SENT" ]]
}
wait_until "$SETTLE_TIMEOUT" "all events in ClickHouse" stored_matches || true

FINAL_COUNT="$(ch_run_count "$RUN_ID")"
UNIQUE="$(ch_run_unique "$RUN_ID")"
RAW="$(ch_run_raw "$RUN_ID")"
DLQ="$(h dlq)"
STATUS=FAIL
if [[ "$SENT" -gt 0 && "$FINAL_COUNT" -eq "$SENT" && "$UNIQUE" -eq "$SENT" && "$DLQ" -eq 0 ]]; then
  STATUS=PASS
fi
report "kill-stream-worker" \
  "kill -9 stream-worker under load (${RATE}x20 ev/s), restart after ${DOWN_SECONDS}s: no loss, no duplicates in analytics" \
  "sent $SENT, events FINAL $FINAL_COUNT, unique event_id $UNIQUE, raw rows $RAW (duplicates collapsed by ReplacingMergeTree: $((RAW - FINAL_COUNT))), DLQ $DLQ" \
  "$STATUS"
[[ "$STATUS" == PASS ]]
