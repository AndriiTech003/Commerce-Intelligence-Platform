#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE="${PROFILE:-smoke}"
HELPERS="$ROOT/infra/chaos/helpers.mjs"
STACK_CTL="$ROOT/scripts/stack-ctl.mjs"
WORK="$ROOT/.observability/chaos/$(basename "$0" .sh)-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$WORK"

log() {
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

h() {
  node "$HELPERS" "$@"
}

load_env() {
  eval "$(node "$ROOT/scripts/loadtest-env.mjs" "$PROFILE")"
  log "stack $PROFILE: api $API_URL, collector $COLLECTOR_URL, vhost $RABBITMQ_VHOST, tenant $TENANT_ID"
}

require_chaos_stack() {
  if [[ "${STACK_CHAOS:-0}" != "1" ]]; then
    echo "chaos: the $PROFILE stack must be started with STACK_CHAOS=1 (STACK_CHAOS=1 node scripts/stack.mjs $PROFILE) so a killed service does not tear it down" >&2
    exit 2
  fi
}

uuid() {
  node -e 'console.log(crypto.randomUUID())'
}

start_load() {
  local name="$1"
  shift
  log "load: k6 $name $*"
  env "$@" API_URL="$API_URL" COLLECTOR_URL="$COLLECTOR_URL" TRACKING_KEY="$TRACKING_KEY" TENANT_ID="$TENANT_ID" \
    STORE="$STORE" STREAM_METRICS_URL="$STREAM_METRICS_URL" SUMMARY="$WORK/$name.json" \
    k6 run -q --no-color "$ROOT/infra/k6/$name.js" >"$WORK/$name.log" 2>&1 &
  LOAD_PID=$!
}

wait_load() {
  wait "${LOAD_PID:-}" || true
  LOAD_PID=""
  tail -n 25 "$WORK/$1.log" || true
  return 0
}

stop_load() {
  if [[ -n "${LOAD_PID:-}" ]] && kill -0 "$LOAD_PID" 2>/dev/null; then
    kill -INT "$LOAD_PID" 2>/dev/null || true
    wait "$LOAD_PID" 2>/dev/null || true
  fi
  LOAD_PID=""
}

wait_until() {
  local timeout="$1" label="$2"
  shift 2
  local deadline=$((SECONDS + timeout))
  until "$@"; do
    if ((SECONDS >= deadline)); then
      log "timeout after ${timeout}s waiting for $label"
      return 1
    fi
    sleep 2
  done
}

ch_run_count() {
  h ch "SELECT count() FROM events FINAL WHERE tenant_id = '$TENANT_ID' AND session_id = '$1'"
}

ch_run_unique() {
  h ch "SELECT uniqExact(event_id) FROM events WHERE tenant_id = '$TENANT_ID' AND session_id = '$1'"
}

ch_run_raw() {
  h ch "SELECT count() FROM events WHERE tenant_id = '$TENANT_ID' AND session_id = '$1'"
}

report() {
  local scenario="$1" expectation="$2" observed="$3" status="$4"
  echo
  echo "RESULT: $(h result "$scenario" "$expectation" "$observed" "$status")"
  echo "details: $WORK"
}
