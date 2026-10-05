#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBS="$ROOT/.observability"
PIDS="$OBS/pids"
LOGS="$OBS/logs"
JAEGER_VERSION="${JAEGER_VERSION:-2.20.0}"
JAEGER_BIN="$OBS/bin/jaeger-$JAEGER_VERSION"
PROMETHEUS_BIN="${PROMETHEUS_BIN:-$(command -v prometheus || echo /opt/homebrew/bin/prometheus)}"
GRAFANA_BIN="${GRAFANA_BIN:-$(command -v grafana || echo /opt/homebrew/bin/grafana)}"
GRAFANA_HOME="${GRAFANA_HOME:-$(brew --prefix grafana 2>/dev/null || echo /opt/homebrew/opt/grafana)/share/grafana}"

PROMETHEUS_PORT=4191
GRAFANA_PORT=4192
JAEGER_UI_PORT=4193
JAEGER_OTLP_HTTP_PORT=4194
JAEGER_OTLP_GRPC_PORT=4195
EXPORTER_PORT=4197
DATASTORE_EXPORTER_PORT=4196

COMPONENTS=(jaeger rabbitmq-exporter datastore-exporter prometheus grafana)

port_of() {
  case "$1" in
    jaeger) echo "$JAEGER_UI_PORT" ;;
    rabbitmq-exporter) echo "$EXPORTER_PORT" ;;
    datastore-exporter) echo "$DATASTORE_EXPORTER_PORT" ;;
    prometheus) echo "$PROMETHEUS_PORT" ;;
    grafana) echo "$GRAFANA_PORT" ;;
  esac
}

health_url() {
  case "$1" in
    jaeger) echo "http://127.0.0.1:$JAEGER_UI_PORT/api/v3/services" ;;
    rabbitmq-exporter) echo "http://127.0.0.1:$EXPORTER_PORT/health" ;;
    datastore-exporter) echo "http://127.0.0.1:$DATASTORE_EXPORTER_PORT/health" ;;
    prometheus) echo "http://127.0.0.1:$PROMETHEUS_PORT/-/ready" ;;
    grafana) echo "http://127.0.0.1:$GRAFANA_PORT/api/health" ;;
  esac
}

pid_of() {
  local file="$PIDS/$1.pid"
  [[ -f "$file" ]] || return 1
  local pid
  pid="$(cat "$file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "$pid"
    return 0
  fi
  rm -f "$file"
  return 1
}

port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

wait_healthy() {
  local name="$1" url
  url="$(health_url "$name")"
  for _ in $(seq 1 120); do
    if curl -sf -m 2 -o /dev/null "$url"; then
      return 0
    fi
    if ! pid_of "$name" >/dev/null; then
      echo "observability: $name exited, see $LOGS/$name.log" >&2
      tail -n 20 "$LOGS/$name.log" >&2 || true
      return 1
    fi
    sleep 0.5
  done
  echo "observability: $name did not become healthy at $url" >&2
  return 1
}

install_jaeger() {
  [[ -x "$JAEGER_BIN" ]] && return 0
  local arch
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    *) arch=amd64 ;;
  esac
  local os
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  local name="jaeger-$JAEGER_VERSION-$os-$arch"
  local base="https://github.com/jaegertracing/jaeger/releases/download/v$JAEGER_VERSION"
  local tmp="$OBS/downloads"
  mkdir -p "$tmp" "$OBS/bin"
  echo "observability: downloading $name"
  curl -fsSL -o "$tmp/$name.tar.gz" "$base/$name.tar.gz"
  curl -fsSL -o "$tmp/$name.sha256sum.txt" "$base/$name.sha256sum.txt"
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp" "$name/jaeger"
  local expected actual
  expected="$(grep -E " \*?$name/jaeger$" "$tmp/$name.sha256sum.txt" | awk '{print $1}')"
  actual="$(shasum -a 256 "$tmp/$name/jaeger" | awk '{print $1}')"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    echo "observability: checksum mismatch for $name/jaeger" >&2
    exit 1
  fi
  mv "$tmp/$name/jaeger" "$JAEGER_BIN"
  chmod +x "$JAEGER_BIN"
  rm -rf "${tmp:?}/$name" "$tmp/$name.tar.gz" "$tmp/$name.sha256sum.txt"
}

launch() {
  local name="$1"
  shift
  if pid="$(pid_of "$name")"; then
    echo "observability: $name already running (pid $pid)"
    return 0
  fi
  local port
  port="$(port_of "$name")"
  if port_busy "$port"; then
    echo "observability: port $port for $name is used by another process" >&2
    return 1
  fi
  nohup "$@" >>"$LOGS/$name.log" 2>&1 &
  echo $! >"$PIDS/$name.pid"
  wait_healthy "$name"
  echo "observability: $name started (pid $(cat "$PIDS/$name.pid"))"
}

start_jaeger() {
  install_jaeger
  launch jaeger "$JAEGER_BIN" --config "$ROOT/infra/jaeger/jaeger.yml"
}

start_exporter() {
  launch rabbitmq-exporter node "$ROOT/infra/prometheus/rabbitmq-exporter.mjs"
  launch datastore-exporter node "$ROOT/infra/prometheus/datastore-exporter.mjs"
}

start_prometheus() {
  mkdir -p "$OBS/prometheus/data"
  launch prometheus "$PROMETHEUS_BIN" \
    --config.file="$ROOT/infra/prometheus/prometheus.local.yml" \
    --storage.tsdb.path="$OBS/prometheus/data" \
    --storage.tsdb.retention.time="${PROMETHEUS_RETENTION:-7d}" \
    --web.listen-address="127.0.0.1:$PROMETHEUS_PORT" \
    --web.external-url="http://127.0.0.1:$PROMETHEUS_PORT/" \
    --web.enable-lifecycle
}

start_grafana() {
  mkdir -p "$OBS/grafana/data" "$OBS/grafana/logs" "$OBS/grafana/plugins"
  if pid="$(pid_of grafana)"; then
    echo "observability: grafana already running (pid $pid)"
    return 0
  fi
  if port_busy "$GRAFANA_PORT"; then
    echo "observability: port $GRAFANA_PORT for grafana is used by another process" >&2
    return 1
  fi
  (
    cd "$OBS/grafana"
    export GF_PATHS_DATA="$OBS/grafana/data"
    export GF_PATHS_LOGS="$OBS/grafana/logs"
    export GF_PATHS_PLUGINS="$OBS/grafana/plugins"
    export GF_PATHS_PROVISIONING="$ROOT/infra/grafana/provisioning"
    export CIP_PROMETHEUS_URL="http://127.0.0.1:$PROMETHEUS_PORT"
    export CIP_JAEGER_URL="http://127.0.0.1:$JAEGER_UI_PORT"
    export CIP_GRAFANA_DASHBOARDS="$ROOT/infra/grafana/dashboards"
    nohup "$GRAFANA_BIN" server --homepath "$GRAFANA_HOME" --config "$ROOT/infra/grafana/grafana.ini" \
      >>"$LOGS/grafana.log" 2>&1 &
    echo $! >"$PIDS/grafana.pid"
  )
  wait_healthy grafana
  echo "observability: grafana started (pid $(cat "$PIDS/grafana.pid"))"
}

stop_one() {
  local name="$1" pid
  if ! pid="$(pid_of "$name")"; then
    echo "observability: $name not running"
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PIDS/$name.pid"
  echo "observability: $name stopped"
}

status() {
  local failed=0 name pid state
  for name in "${COMPONENTS[@]}"; do
    if pid="$(pid_of "$name")"; then
      if curl -sf -m 2 -o /dev/null "$(health_url "$name")"; then
        state="up (pid $pid)"
      else
        state="running but unhealthy (pid $pid)"
        failed=1
      fi
    else
      state="stopped"
      failed=1
    fi
    printf '%-18s %-6s %s\n' "$name" "$(port_of "$name")" "$state"
  done
  echo
  echo "Prometheus  http://127.0.0.1:$PROMETHEUS_PORT"
  echo "Grafana     http://127.0.0.1:$GRAFANA_PORT  (admin/admin, anonymous viewer)"
  echo "Jaeger UI   http://127.0.0.1:$JAEGER_UI_PORT"
  echo "OTLP        OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:$JAEGER_OTLP_HTTP_PORT  (gRPC 127.0.0.1:$JAEGER_OTLP_GRPC_PORT)"
  return "$failed"
}

mkdir -p "$PIDS" "$LOGS"

case "${1:-status}" in
  start)
    start_jaeger
    start_exporter
    start_prometheus
    start_grafana
    status
    ;;
  stop)
    for ((i = ${#COMPONENTS[@]} - 1; i >= 0; i--)); do
      stop_one "${COMPONENTS[$i]}"
    done
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    status
    ;;
  install)
    install_jaeger
    echo "observability: jaeger at $JAEGER_BIN"
    ;;
  reload)
    curl -sf -X POST "http://127.0.0.1:$PROMETHEUS_PORT/-/reload" && echo "observability: prometheus config reloaded"
    curl -sf -u admin:admin -X POST "http://127.0.0.1:$GRAFANA_PORT/api/admin/provisioning/dashboards/reload" >/dev/null &&
      curl -sf -u admin:admin -X POST "http://127.0.0.1:$GRAFANA_PORT/api/admin/provisioning/alerting/reload" >/dev/null &&
      echo "observability: grafana provisioning reloaded"
    ;;
  *)
    echo "usage: $0 start|stop|restart|status|install|reload" >&2
    exit 2
    ;;
esac
