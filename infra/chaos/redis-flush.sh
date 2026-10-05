#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE="${MODE:-prefix}"
RATE="${RATE:-20}"
DURATION="${DURATION:-45s}"
FLUSH_AFTER="${FLUSH_AFTER:-15}"

load_env
REDIS_DB="${REDIS_URL##*/}"
if [[ "$REDIS_DB" != "1" ]]; then
  echo "chaos: refusing to touch Redis db $REDIS_DB (this project uses db 1 only)" >&2
  exit 2
fi

trap stop_load EXIT INT TERM

ORDER_FILE="$WORK/order.json"
h order-with-key >"$ORDER_FILE"
ORDER_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).orderId)' "$ORDER_FILE")"
KEY="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).key)' "$ORDER_FILE")"
log "order $ORDER_ID placed with Idempotency-Key $KEY"

start_load decision-api RATE="$RATE" DURATION="$DURATION" PROFILES=500 WARM_SHARE=0.4 WARM_WAIT_SECONDS=5
sleep "$FLUSH_AFTER"
if [[ "$MODE" == flushdb ]]; then
  if [[ "${CONFIRM_FLUSHDB:-0}" != 1 ]]; then
    echo "chaos: MODE=flushdb wipes every key of Redis db 1 (dev data and other stacks); set CONFIRM_FLUSHDB=1" >&2
    exit 2
  fi
  log "FLUSHDB on redis db 1"
  redis-cli -u "$REDIS_URL" flushdb
  DELETED="db1"
else
  [[ -n "$REDIS_PREFIX" ]] || { echo "chaos: empty REDIS_PREFIX, use MODE=flushdb explicitly" >&2; exit 2; }
  DELETED=0
  while IFS= read -r batch; do
    [[ -z "$batch" ]] && continue
    read -r -a keys <<<"$batch"
    n="$(redis-cli -u "$REDIS_URL" del "${keys[@]}")"
    DELETED=$((DELETED + n))
  done < <(redis-cli -u "$REDIS_URL" --scan --pattern "${REDIS_PREFIX}*" | xargs -n 500 echo)
  log "deleted $DELETED keys with prefix $REDIS_PREFIX from db 1"
fi
REPLAY="$(h replay "$ORDER_FILE")"
log "checkout replay with the same key after the flush: $REPLAY"
wait_load decision-api

ERR_RATE="$(h summary "$WORK/decision-api.json" errorRate)"
D200="$(h summary "$WORK/decision-api.json" custom.decisions_200.count)"
D204="$(h summary "$WORK/decision-api.json" custom.decisions_204.count)"
P95="$(h summary "$WORK/decision-api.json" decisionLatencyMs.p95)"
ORDERS_WITH_KEY="$(psql "$DATABASE_ADMIN_URL" -tAc "select count(*) from orders where idempotency_key = '$KEY'")"
REPLAY_ID="$(node -e 'console.log(JSON.parse(process.argv[1]).orderId ?? "")' "$REPLAY")"
REPLAY_STATUS="$(node -e 'console.log(JSON.parse(process.argv[1]).status)' "$REPLAY")"
STATUS=FAIL
if [[ "$ERR_RATE" == 0 && "$ORDERS_WITH_KEY" -eq 1 && ("$REPLAY_ID" == "$ORDER_ID" || "$REPLAY_STATUS" =~ ^4) ]]; then
  STATUS=PASS
fi
report "redis-flush ($MODE)" \
  "Redis keys lost: decision API keeps answering without errors (profiles/bandit from snapshots); idempotency protected by the unique index" \
  "deleted $DELETED keys; decisions 200=${D200:-0} 204=${D204:-0}, error rate $ERR_RATE, p95 ${P95}ms; replay after flush -> HTTP $REPLAY_STATUS order ${REPLAY_ID:-none}; orders with the key: $ORDERS_WITH_KEY" \
  "$STATUS"
[[ "$STATUS" == PASS ]]
