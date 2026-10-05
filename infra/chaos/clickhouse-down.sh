#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PAUSE_SECONDS="${PAUSE_SECONDS:-120}"
RATE="${RATE:-10}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-480}"
CH_PORT="${CH_PORT:-8123}"

load_env
RUN_ID="$(uuid)"
CH_PID="$(lsof -nP -iTCP:"$CH_PORT" -sTCP:LISTEN -t | head -n 1)"
[[ -n "$CH_PID" ]] || { echo "chaos: no ClickHouse process listens on $CH_PORT" >&2; exit 2; }
PAUSED=0

resume() {
  if [[ "$PAUSED" == 1 ]]; then
    log "kill -CONT $CH_PID (ClickHouse resumed)"
    kill -CONT "$CH_PID" 2>/dev/null || true
    PAUSED=0
  fi
}

restore() {
  resume
  stop_load
}
trap restore EXIT INT TERM

start_load pipeline-e2e RATE="$RATE" DURATION="$((PAUSE_SECONDS + 40))s" RUN_ID="$RUN_ID" DRAIN_SECONDS=1 FRESHNESS_P95_TARGET=100000
sleep 10
log "kill -STOP $CH_PID: ClickHouse frozen for ${PAUSE_SECONDS}s (connections hang, nothing is lost on disk)"
PAUSED=1
kill -STOP "$CH_PID"
PEAK=0
END=$((SECONDS + PAUSE_SECONDS))
while ((SECONDS < END)); do
  sleep 10
  depth="$(h backlog || echo 0)"
  ((depth > PEAK)) && PEAK="$depth"
  log "backlog (main + retry queues): $depth"
done
resume
wait_load pipeline-e2e

drained() {
  local depth
  depth="$(h backlog)"
  log "backlog $depth, DLQ $(h dlq)"
  [[ "$depth" -eq 0 ]]
}
wait_until "$DRAIN_TIMEOUT" "queues drained" drained || true
SENT="$(h summary "$WORK/pipeline-e2e.json" eventsAccepted)"
stored() {
  [[ "$(ch_run_count "$RUN_ID")" -ge "${SENT:-0}" ]]
}
wait_until 120 "events stored" stored || true
FINAL_COUNT="$(ch_run_count "$RUN_ID")"
UNIQUE="$(ch_run_unique "$RUN_ID")"
BACKLOG="$(h backlog)"
DLQ="$(h dlq)"
STATUS=FAIL
if [[ "$PEAK" -gt 0 && "$BACKLOG" -eq 0 && "$DLQ" -eq 0 && "$FINAL_COUNT" -eq "$SENT" && "$UNIQUE" -eq "$SENT" ]]; then
  STATUS=PASS
fi
report "clickhouse-down" \
  "ClickHouse unavailable ${PAUSE_SECONDS}s (SIGSTOP): messages retry and accumulate, then drain to 0; DLQ empty; counts match" \
  "backlog peak $PEAK, final backlog $BACKLOG, DLQ $DLQ, sent $SENT, events FINAL $FINAL_COUNT, unique $UNIQUE" \
  "$STATUS"
[[ "$STATUS" == PASS ]]
