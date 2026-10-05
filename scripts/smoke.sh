#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p .smoke

for port in 4180 4181 4182 4183 4184 4185 4186 4187; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "smoke: port ${port} is already in use" >&2
    exit 1
  fi
done

if [ "${SMOKE_SKIP_BUILD:-0}" != "1" ]; then
  echo "smoke: building all apps and packages (production builds)"
  pnpm turbo run build --output-logs=errors-only >.smoke/build.log 2>&1
fi

STACK_PID=""
cleanup() {
  local code=$?
  if [ -n "$STACK_PID" ] && kill -0 "$STACK_PID" >/dev/null 2>&1; then
    kill -TERM "$STACK_PID" >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
      kill -0 "$STACK_PID" >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi
  for port in 4180 4181 4182 4183 4184 4185 4186 4187; do
    pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids >/dev/null 2>&1 || true
  done
  if [ "$code" -eq 0 ]; then echo "smoke: PASSED"; else echo "smoke: FAILED (exit ${code}), logs in .smoke/"; fi
  exit "$code"
}
trap cleanup EXIT INT TERM

echo "smoke: provisioning throwaway database, vhost, ClickHouse db, seeding and starting all services"
rm -f .smoke/smoke.json
node scripts/stack.mjs smoke >.smoke/stack.log 2>&1 &
STACK_PID=$!
for _ in $(seq 1 360); do
  [ -f .smoke/smoke.json ] && break
  if ! kill -0 "$STACK_PID" >/dev/null 2>&1; then
    cat .smoke/stack.log
    exit 1
  fi
  sleep 0.5
done
[ -f .smoke/smoke.json ] || { echo "smoke: stack did not start"; cat .smoke/stack.log; exit 1; }

node scripts/smoke.mjs smoke
