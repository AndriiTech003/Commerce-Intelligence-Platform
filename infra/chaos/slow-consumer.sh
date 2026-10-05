#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DELAY_MS="${DELAY_MS:-200}"
RATE="${RATE:-75}"
DURATION="${DURATION:-180s}"
QUEUE="${QUEUE:-q.realtime.counters}"
ALERT_PATTERN="${ALERT_PATTERN:-backlog|lag}"
ALERT_TIMEOUT="${ALERT_TIMEOUT:-240}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-600}"

load_env
require_chaos_stack
DELAYED=0

restore() {
  stop_load
  if [[ "$DELAYED" == 1 ]]; then
    log "restore: restarting stream-worker without CHAOS_DELAY_MS"
    node "$STACK_CTL" "$PROFILE" restart stream-worker CHAOS_DELAY_MS=0 || node "$STACK_CTL" "$PROFILE" start stream-worker || true
    DELAYED=0
  fi
}
trap restore EXIT INT TERM

log "restart stream-worker with CHAOS_DELAY_MS=$DELAY_MS (handler of $QUEUE sleeps per message)"
DELAYED=1
node "$STACK_CTL" "$PROFILE" restart stream-worker CHAOS_DELAY_MS="$DELAY_MS"
start_load pipeline-e2e RATE="$RATE" DURATION="$DURATION" DRAIN_SECONDS=1 FRESHNESS_P95_TARGET=100000

PEAK=0
FIRED=""
END=$((SECONDS + ALERT_TIMEOUT))
while ((SECONDS < END)); do
  sleep 10
  depth="$(h queue "$QUEUE" || echo 0)"
  ((depth > PEAK)) && PEAK="$depth"
  FIRED="$(h alert "$ALERT_PATTERN" || true)"
  log "$QUEUE depth $depth, alerts firing: ${FIRED:-none}"
  [[ -n "$FIRED" ]] && break
done
stop_load
LIMITED="$(h summary "$WORK/pipeline-e2e.json" custom.rate_limited_429.count)"
restore

drained() {
  local depth
  depth="$(h queue "$QUEUE")"
  log "$QUEUE depth $depth"
  [[ "$depth" -eq 0 ]]
}
wait_until "$DRAIN_TIMEOUT" "$QUEUE drained" drained || true
FINAL="$(h queue "$QUEUE")"
STATUS=FAIL
if [[ "$PEAK" -gt 500 && -n "$FIRED" && "$FINAL" -eq 0 ]]; then
  STATUS=PASS
fi
report "slow-consumer" \
  "CHAOS_DELAY_MS=$DELAY_MS on $QUEUE under ${RATE}x20 ev/s: lag grows, alert fires, drains after restore" \
  "peak depth $PEAK, alert ${FIRED:-not fired within ${ALERT_TIMEOUT}s}, depth after restore $FINAL, collector 429s ${LIMITED:-0}" \
  "$STATUS"
[[ "$STATUS" == PASS ]]
