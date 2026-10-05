import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PROM = { type: 'prometheus', uid: 'prometheus' };
const P = 'profile="$profile"';
const RMQ = 'vhost=~"$vhost"';
const MAIN_QUEUES = 'queue=~"q\\\\.[a-z.]+", queue!~".*\\\\.(dlq|retry\\\\..+)"';
const DLQ = 'queue=~"q\\\\..+\\\\.dlq"';
const RETRY = 'queue=~"q\\\\..+\\\\.retry\\\\..+"';

function target(expr, legendFormat = '', extra = {}) {
  return { datasource: PROM, expr, legendFormat, range: true, ...extra };
}

function layout(panels) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let id = 1;
  const out = [];
  for (const panel of panels) {
    if (panel.type === 'row') {
      if (x > 0) {
        y += rowHeight;
        x = 0;
        rowHeight = 0;
      }
      out.push({ ...panel, id: id++, gridPos: { h: 1, w: 24, x: 0, y }, collapsed: false, panels: [] });
      y += 1;
      continue;
    }
    const w = panel.w ?? 12;
    const h = panel.h ?? 8;
    if (x + w > 24) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    const { w: _w, h: _h, ...rest } = panel;
    out.push({ ...rest, id: id++, gridPos: { h, w, x, y } });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return out;
}

function row(title) {
  return { type: 'row', title };
}

function stat(
  title,
  expr,
  { unit = 'short', decimals, thresholds, w = 4, h = 4, description, color, legend = '' } = {},
) {
  return {
    type: 'stat',
    title,
    description,
    datasource: PROM,
    w,
    h,
    targets: [target(expr, legend, { instant: true, range: false })],
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: 'background',
      graphMode: 'area',
      textMode: legend ? 'value_and_name' : 'value',
      justifyMode: 'auto',
    },
    fieldConfig: {
      defaults: {
        unit,
        ...(decimals !== undefined ? { decimals } : {}),
        color: { mode: color ? 'fixed' : 'thresholds', ...(color ? { fixedColor: color } : {}) },
        thresholds: {
          mode: 'absolute',
          steps: thresholds ?? [{ color: 'green', value: null }],
        },
        noValue: unit === 's' ? 'no data' : '0',
      },
      overrides: [],
    },
  };
}

function ts(
  title,
  targets,
  { unit = 'short', w = 12, h = 8, stack = false, description, thresholdLine, min } = {},
) {
  return {
    type: 'timeseries',
    title,
    description,
    datasource: PROM,
    w,
    h,
    targets,
    options: {
      legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'], showLegend: true },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
    fieldConfig: {
      defaults: {
        unit,
        ...(min !== undefined ? { min } : {}),
        custom: {
          drawStyle: 'line',
          lineWidth: 1,
          fillOpacity: stack ? 30 : 10,
          showPoints: 'never',
          spanNulls: true,
          stacking: { mode: stack ? 'normal' : 'none', group: 'A' },
          ...(thresholdLine !== undefined ? { thresholdsStyle: { mode: 'line+area' } } : {}),
        },
        thresholds: {
          mode: 'absolute',
          steps:
            thresholdLine !== undefined
              ? [
                  { color: 'transparent', value: null },
                  { color: 'red', value: thresholdLine },
                ]
              : [{ color: 'green', value: null }],
        },
      },
      overrides: [],
    },
  };
}

function bar(title, expr, legendFormat, { unit = 'short', w = 12, h = 8, description } = {}) {
  return {
    type: 'bargauge',
    title,
    description,
    datasource: PROM,
    w,
    h,
    targets: [target(expr, legendFormat, { instant: true, range: false })],
    options: {
      orientation: 'horizontal',
      displayMode: 'gradient',
      showUnfilled: true,
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
    },
    fieldConfig: { defaults: { unit, min: 0 }, overrides: [] },
  };
}

function table(title, expr, { w = 12, h = 8, description, columns } = {}) {
  return {
    type: 'table',
    title,
    description,
    datasource: PROM,
    w,
    h,
    targets: [target(expr, '', { instant: true, range: false, format: 'table' })],
    transformations: [
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, __name__: true },
          renameByName: columns ?? {},
        },
      },
    ],
    fieldConfig: { defaults: {}, overrides: [] },
  };
}

function text(title, content, { w = 24, h = 3 } = {}) {
  return { type: 'text', title, w, h, options: { mode: 'markdown', content } };
}

function q(quantile, metric, by, selector, window = '5m') {
  return `histogram_quantile(${quantile}, sum by (${['le', ...by].join(', ')}) (rate(${metric}_bucket{${selector}}[${window}])))`;
}

const profileVar = {
  name: 'profile',
  label: 'Stack',
  type: 'query',
  datasource: PROM,
  query: { query: 'label_values(up{job=~"cip-.+"}, profile)', refId: 'profile' },
  definition: 'label_values(up{job=~"cip-.+"}, profile)',
  refresh: 2,
  sort: 1,
  current: { selected: true, text: 'dev', value: 'dev' },
  includeAll: false,
  multi: false,
};

const vhostVar = {
  name: 'vhost',
  label: 'RabbitMQ vhost',
  type: 'query',
  datasource: PROM,
  query: { query: 'label_values(rabbitmq_queue_messages, vhost)', refId: 'vhost' },
  definition: 'label_values(rabbitmq_queue_messages, vhost)',
  refresh: 2,
  sort: 1,
  includeAll: true,
  allValue: '.*',
  current: { selected: true, text: 'All', value: '$__all' },
  multi: false,
};

function dashboard({ uid, title, tags, description, panels, variables = [profileVar], refresh = '10s' }) {
  return {
    uid,
    title,
    description,
    tags: ['cip', ...tags],
    editable: true,
    graphTooltip: 1,
    schemaVersion: 39,
    version: 1,
    refresh,
    time: { from: 'now-30m', to: 'now' },
    timepicker: {},
    timezone: 'browser',
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: { type: 'grafana', uid: '-- Grafana --' },
          enable: true,
          hide: true,
          iconColor: 'rgba(0, 211, 255, 1)',
          name: 'Annotations & Alerts',
          type: 'dashboard',
        },
      ],
    },
    links: [
      {
        title: 'CIP dashboards',
        type: 'dashboards',
        tags: ['cip'],
        asDropdown: true,
        includeVars: true,
        keepTime: true,
      },
    ],
    templating: { list: variables },
    panels: layout(panels),
  };
}

const httpRate = `sum by (service) (rate(http_requests_total{${P}, route!~"/metrics|/health.*"}[1m])) or sum by (service) (rate(collector_request_duration_seconds_count{${P}}[1m]))`;
const http5xx = `(sum by (service) (rate(http_requests_total{${P}, status=~"5.."}[5m])) / sum by (service) (rate(http_requests_total{${P}}[5m]))) or (sum by (service) (rate(collector_request_duration_seconds_count{${P}, status=~"5.."}[5m])) / sum by (service) (rate(collector_request_duration_seconds_count{${P}}[5m])))`;
const http4xx = `(sum by (service) (rate(http_requests_total{${P}, status=~"4.."}[5m])) / sum by (service) (rate(http_requests_total{${P}}[5m]))) or (sum by (service) (rate(collector_request_duration_seconds_count{${P}, status=~"4.."}[5m])) / sum by (service) (rate(collector_request_duration_seconds_count{${P}}[5m])))`;
const latency = (quantile) =>
  `${q(quantile, 'http_request_duration_seconds', ['service'], `${P}, route!~"/metrics|/health.*"`)} or ${q(quantile, 'collector_request_duration_seconds', ['service'], P)}`;

const systemOverview = dashboard({
  uid: 'cip-system-overview',
  title: 'CIP · System overview',
  tags: ['overview', 'red'],
  description: 'RED metrics (rate, errors, duration) and runtime health per service of the selected stack',
  panels: [
    stat('Services up', `sum(up{job=~"cip-.+", ${P}})`, {
      description: 'Scrape targets of the stack that answered /metrics',
      thresholds: [
        { color: 'red', value: null },
        { color: 'green', value: 5 },
      ],
    }),
    stat(
      'API req/s',
      `sum(rate(http_requests_total{${P}, service="api", route!~"/metrics|/health.*"}[1m]))`,
      {
        unit: 'reqps',
        decimals: 1,
      },
    ),
    stat(
      'API 5xx ratio',
      `sum(rate(http_requests_total{${P}, service="api", status=~"5.."}[5m])) / sum(rate(http_requests_total{${P}, service="api"}[5m]))`,
      {
        unit: 'percentunit',
        decimals: 2,
        thresholds: [
          { color: 'green', value: null },
          { color: 'red', value: 0.01 },
        ],
      },
    ),
    stat(
      'API p95',
      q(0.95, 'http_request_duration_seconds', [], `${P}, service="api", route!~"/metrics|/health.*"`),
      {
        unit: 's',
        thresholds: [
          { color: 'green', value: null },
          { color: 'orange', value: 0.2 },
          { color: 'red', value: 0.3 },
        ],
      },
    ),
    stat('Collector events/s', `sum(rate(collector_events_total{${P}, outcome!="rejected"}[1m]))`, {
      unit: 'short',
      decimals: 0,
    }),
    stat('Collector p95', q(0.95, 'collector_request_duration_seconds', [], P), {
      unit: 's',
      thresholds: [
        { color: 'green', value: null },
        { color: 'red', value: 0.1 },
      ],
    }),
    row('Rate · Errors · Duration'),
    ts('Requests per second by service', [target(httpRate, '{{service}}')], { unit: 'reqps', stack: true }),
    ts('Error ratio by service', [target(http5xx, '5xx {{service}}'), target(http4xx, '4xx {{service}}')], {
      unit: 'percentunit',
      thresholdLine: 0.01,
      description: '5xx alert threshold: 1 % over 5 minutes',
    }),
    ts(
      'Latency by service (p50 / p95 / p99)',
      [
        target(latency(0.5), 'p50 {{service}}'),
        target(latency(0.95), 'p95 {{service}}'),
        target(latency(0.99), 'p99 {{service}}'),
      ],
      { unit: 's', w: 24 },
    ),
    ts(
      'Top API routes by rate',
      [
        target(
          `topk(10, sum by (method, route) (rate(http_requests_total{${P}, service="api", route!~"/metrics|/health.*"}[5m])))`,
          '{{method}} {{route}}',
        ),
      ],
      { unit: 'reqps' },
    ),
    ts(
      'Slowest API routes (p95)',
      [
        target(
          `topk(10, ${q(0.95, 'http_request_duration_seconds', ['method', 'route'], `${P}, service="api", route!~"/metrics|/health.*"`)})`,
          '{{method}} {{route}}',
        ),
      ],
      { unit: 's' },
    ),
    ts(
      'API responses by status',
      [
        target(
          `sum by (status) (rate(http_requests_total{${P}, service="api", route!~"/metrics|/health.*"}[1m]))`,
          '{{status}}',
        ),
      ],
      { unit: 'reqps', stack: true },
    ),
    table('Scrape targets', `up{job=~"cip-.+", ${P}}`, {
      columns: { Value: 'up', instance: 'target' },
      description: '1 = target answered the last scrape',
    }),
    row('Runtime'),
    ts(
      'Event loop lag p99',
      [target(`max by (service) (nodejs_eventloop_lag_p99_seconds{${P}})`, '{{service}}')],
      {
        unit: 's',
        w: 8,
        thresholdLine: 0.2,
      },
    ),
    ts(
      'CPU (cores)',
      [target(`sum by (service) (rate(process_cpu_seconds_total{${P}}[1m]))`, '{{service}}')],
      {
        unit: 'short',
        w: 8,
      },
    ),
    ts('Resident memory', [target(`sum by (service) (process_resident_memory_bytes{${P}})`, '{{service}}')], {
      unit: 'bytes',
      w: 8,
    }),
    ts('Heap used', [target(`sum by (service) (nodejs_heap_size_used_bytes{${P}})`, '{{service}}')], {
      unit: 'bytes',
      w: 8,
    }),
    ts(
      'GC time per second',
      [target(`sum by (service) (rate(nodejs_gc_duration_seconds_sum{${P}}[1m]))`, '{{service}}')],
      {
        unit: 's',
        w: 8,
      },
    ),
    ts(
      'Open handles / WebSocket connections',
      [
        target(`sum by (service) (nodejs_active_handles_total{${P}})`, 'handles {{service}}'),
        target(`sum(ws_connections{${P}})`, 'ws connections'),
      ],
      { w: 8 },
    ),
    row('Datastores (datastore exporter: Postgres, Redis, ClickHouse)'),
    stat('Postgres up', 'max(pg_up)', {
      w: 4,
      thresholds: [
        { color: 'red', value: null },
        { color: 'green', value: 1 },
      ],
    }),
    stat('Redis up', 'max(redis_up)', {
      w: 4,
      thresholds: [
        { color: 'red', value: null },
        { color: 'green', value: 1 },
      ],
    }),
    stat('ClickHouse up', 'max(clickhouse_up)', {
      w: 4,
      thresholds: [
        { color: 'red', value: null },
        { color: 'green', value: 1 },
      ],
    }),
    stat(
      'Postgres buffer cache hit ratio',
      'sum(rate(pg_stat_database_blks_hit_total[5m])) / clamp_min(sum(rate(pg_stat_database_blks_hit_total[5m])) + sum(rate(pg_stat_database_blks_read_total[5m])), 1)',
      { unit: 'percentunit', decimals: 2, w: 4 },
    ),
    stat('Postgres lock waits', 'sum(pg_locks_waiting) or vector(0)', {
      w: 4,
      thresholds: [
        { color: 'green', value: null },
        { color: 'orange', value: 1 },
      ],
    }),
    stat(
      'Redis keyspace hit ratio',
      'sum(rate(redis_keyspace_hits_total[5m])) / clamp_min(sum(rate(redis_keyspace_hits_total[5m])) + sum(rate(redis_keyspace_misses_total[5m])), 1)',
      {
        unit: 'percentunit',
        decimals: 2,
        w: 4,
      },
    ),
    ts(
      'Postgres transactions per second',
      [
        target('sum by (datname) (rate(pg_stat_database_xact_commit_total[1m]))', 'commit {{datname}}'),
        target('sum by (datname) (rate(pg_stat_database_xact_rollback_total[1m]))', 'rollback {{datname}}'),
      ],
      { unit: 'ops', w: 8 },
    ),
    ts('Postgres connections by state', [target('sum by (state) (pg_stat_activity_count)', '{{state}}')], {
      w: 8,
      stack: true,
    }),
    ts(
      'Postgres rows written per second',
      [
        target('sum(rate(pg_stat_database_tup_inserted_total[1m]))', 'inserted'),
        target('sum(rate(pg_stat_database_tup_updated_total[1m]))', 'updated'),
        target('sum(rate(pg_stat_database_tup_deleted_total[1m]))', 'deleted'),
      ],
      { unit: 'rowsps', w: 8 },
    ),
    ts('Redis commands per second', [target('sum(rate(redis_commands_processed_total[1m]))', 'commands')], {
      unit: 'ops',
      w: 8,
    }),
    ts(
      'Redis memory and keys',
      [
        target('max(redis_memory_used_bytes)', 'used memory'),
        target('sum by (db) (redis_db_keys)', 'keys {{db}}'),
      ],
      { w: 8 },
    ),
    ts(
      'ClickHouse inserts and queries per second',
      [
        target('sum(rate(clickhouse_event_total{event="InsertedRows"}[1m]))', 'inserted rows/s'),
        target('sum(rate(clickhouse_event_total{event="Query"}[1m]))', 'queries/s'),
        target('sum(rate(clickhouse_event_total{event="FailedQuery"}[1m]))', 'failed queries/s'),
      ],
      { w: 8 },
    ),
    ts(
      'ClickHouse rows per table (project databases)',
      [target('topk(10, clickhouse_table_rows{table!="schema_migrations"})', '{{database}}.{{table}}')],
      { w: 12 },
    ),
    ts('Postgres database size', [target('sum by (datname) (pg_database_size_bytes)', '{{datname}}')], {
      unit: 'bytes',
      w: 12,
    }),
  ],
});

const eventPipeline = dashboard({
  uid: 'cip-event-pipeline',
  title: 'CIP · Event pipeline',
  tags: ['pipeline', 'rabbitmq'],
  description:
    'Collector → RabbitMQ → stream-worker/domain-worker → ClickHouse/Redis. Queue depth comes from the RabbitMQ management API via infra/prometheus/rabbitmq-exporter.mjs (or rabbitmq_prometheus per-object metrics)',
  variables: [profileVar, vhostVar],
  refresh: '5s',
  panels: [
    stat('Ingest (events/s)', `sum(rate(collector_events_total{${P}, outcome=~"published|buffered"}[1m]))`, {
      decimals: 0,
    }),
    stat(
      'Freshness p95 (analytics)',
      q(0.95, 'message_end_to_end_seconds', [], `${P}, queue="q.analytics.ingest"`),
      {
        unit: 's',
        thresholds: [
          { color: 'green', value: null },
          { color: 'orange', value: 2 },
          { color: 'red', value: 10 },
        ],
      },
    ),
    stat('Backlog (main queues)', `sum(rabbitmq_queue_messages{${RMQ}, ${MAIN_QUEUES}})`, {
      thresholds: [
        { color: 'green', value: null },
        { color: 'orange', value: 500 },
        { color: 'red', value: 5000 },
      ],
    }),
    stat('DLQ messages', `sum(rabbitmq_queue_messages{${RMQ}, ${DLQ}})`, {
      thresholds: [
        { color: 'green', value: null },
        { color: 'red', value: 1 },
      ],
    }),
    stat('Collector buffer', `sum(collector_buffer_size{${P}})`, {
      description: 'Events held in memory while the broker is unavailable',
      thresholds: [
        { color: 'green', value: null },
        { color: 'orange', value: 1 },
      ],
    }),
    stat('Oldest unpublished outbox row', `max(outbox_oldest_unpublished_seconds{${P}})`, {
      unit: 's',
      thresholds: [
        { color: 'green', value: null },
        { color: 'red', value: 60 },
      ],
    }),
    row('Ingest'),
    ts(
      'Collector events by outcome',
      [target(`sum by (outcome) (rate(collector_events_total{${P}}[1m]))`, '{{outcome}}')],
      {
        stack: true,
        w: 8,
      },
    ),
    ts(
      'Collector request latency',
      [
        target(q(0.5, 'collector_request_duration_seconds', [], P), 'p50'),
        target(q(0.95, 'collector_request_duration_seconds', [], P), 'p95'),
        target(q(0.99, 'collector_request_duration_seconds', [], P), 'p99'),
      ],
      { unit: 's', w: 8, thresholdLine: 0.1 },
    ),
    ts(
      'Published to RabbitMQ',
      [
        target(
          `sum by (service, exchange, outcome) (rate(messages_published_total{${P}}[1m]))`,
          '{{service}} → {{exchange}} ({{outcome}})',
        ),
      ],
      {
        w: 8,
      },
    ),
    row('Queues'),
    ts(
      'Queue depth (ready)',
      [target(`sum by (queue) (rabbitmq_queue_messages_ready{${RMQ}, ${MAIN_QUEUES}})`, '{{queue}}')],
      {
        stack: true,
        description: 'Growing ready count = consumer lag',
      },
    ),
    ts(
      'In flight (unacked)',
      [target(`sum by (queue) (rabbitmq_queue_messages_unacked{${RMQ}, ${MAIN_QUEUES}})`, '{{queue}}')],
      {
        stack: true,
      },
    ),
    ts(
      'Consumed by queue and outcome',
      [target(`sum by (queue, outcome) (rate(messages_consumed_total{${P}}[1m]))`, '{{queue}} {{outcome}}')],
      {
        unit: 'short',
      },
    ),
    ts('Broker publish vs deliver rate', [
      target(
        `sum by (queue) (rate(rabbitmq_queue_messages_published_total{${RMQ}, ${MAIN_QUEUES}}[1m]))`,
        'in {{queue}}',
      ),
      target(
        `sum by (queue) (rate(rabbitmq_queue_messages_acked_total{${RMQ}, ${MAIN_QUEUES}}[1m]))`,
        'acked {{queue}}',
      ),
    ]),
    ts('Retry queues', [target(`sum by (queue) (rabbitmq_queue_messages{${RMQ}, ${RETRY}})`, '{{queue}}')], {
      w: 8,
    }),
    bar('DLQ depth by queue', `sum by (queue) (rabbitmq_queue_messages{${RMQ}, ${DLQ}})`, '{{queue}}', {
      w: 8,
    }),
    ts(
      'Consumers per queue',
      [target(`sum by (queue) (rabbitmq_queue_consumers{${RMQ}, ${MAIN_QUEUES}})`, '{{queue}}')],
      {
        w: 8,
        description: '0 consumers on a main queue = the worker is down',
      },
    ),
    row('Freshness and processing'),
    ts(
      'End-to-end freshness p95 (occurred_at → processed)',
      [target(q(0.95, 'message_end_to_end_seconds', ['queue'], P), '{{queue}}')],
      { unit: 's', thresholdLine: 10 },
    ),
    ts(
      'Freshness of analytics (p50 / p95 / p99)',
      [
        target(q(0.5, 'message_end_to_end_seconds', [], `${P}, queue="q.analytics.ingest"`), 'p50'),
        target(q(0.95, 'message_end_to_end_seconds', [], `${P}, queue="q.analytics.ingest"`), 'p95'),
        target(q(0.99, 'message_end_to_end_seconds', [], `${P}, queue="q.analytics.ingest"`), 'p99'),
      ],
      {
        unit: 's',
        thresholdLine: 2,
        description: 'SLO: 99 % of events visible in < 5 s; load target p95 < 2 s',
      },
    ),
    ts(
      'Handler time p95 by queue',
      [target(q(0.95, 'message_processing_seconds', ['queue'], P), '{{queue}}')],
      { unit: 's' },
    ),
    ts('Batch flushes and size', [
      target(
        `sum by (queue, outcome) (rate(consumer_batch_flushes_total{${P}}[1m]))`,
        'flush {{queue}} {{outcome}}',
      ),
      target(q(0.5, 'consumer_batch_size', ['queue'], P), 'p50 size {{queue}}'),
    ]),
    row('Sinks'),
    ts(
      'ClickHouse rows inserted/s',
      [target(`sum(rate(clickhouse_rows_inserted_total{${P}}[1m]))`, 'rows/s')],
      { w: 8 },
    ),
    ts(
      'ClickHouse insert and dedupe check p95',
      [
        target(q(0.95, 'clickhouse_insert_seconds', [], P), 'insert p95'),
        target(q(0.95, 'clickhouse_dedupe_check_seconds', [], P), 'dedupe check p95'),
      ],
      { unit: 's', w: 8 },
    ),
    ts(
      'Duplicates dropped',
      [
        target(`sum(rate(analytics_duplicates_total{${P}}[1m]))`, 'analytics (Redis)'),
        target(`sum(rate(analytics_clickhouse_duplicates_total{${P}}[1m]))`, 'analytics (ClickHouse check)'),
        target(`sum by (queue) (rate(messages_duplicate_total{${P}}[1m]))`, '{{queue}}'),
      ],
      { w: 8 },
    ),
    ts(
      'Outbox',
      [
        target(`sum(rate(outbox_published_total{${P}}[1m]))`, 'published/s'),
        target(`sum(rate(outbox_publish_failures_total{${P}}[1m]))`, 'failures/s'),
        target(`max(outbox_oldest_unpublished_seconds{${P}})`, 'oldest unpublished (s)'),
      ],
      { w: 8 },
    ),
    ts(
      'Realtime',
      [
        target(`sum(ws_connections{${P}})`, 'ws connections'),
        target(`sum(rate(realtime_ticks_published_total{${P}}[1m]))`, 'ticks/s'),
        target(`sum by (kind) (rate(ws_messages_sent_total{${P}}[1m]))`, 'sent {{kind}}'),
        target(`sum(rate(ws_messages_dropped_total{${P}}[1m]))`, 'dropped'),
      ],
      { w: 8 },
    ),
    ts(
      'Notifications and webhooks',
      [
        target(`sum by (type) (rate(notifications_sent_total{${P}}[5m]))`, 'email {{type}}'),
        target(`sum by (outcome) (rate(webhook_deliveries_total{${P}}[5m]))`, 'webhook {{outcome}}'),
      ],
      { w: 8 },
    ),
  ],
});

const placed = (window) => `sum(increase(orders_placed_total{${P}}[${window}]))`;
const tracked = (type, window) =>
  `sum(increase(collector_events_by_type_total{${P}, event_type="${type}"}[${window}]))`;
const business = dashboard({
  uid: 'cip-business',
  title: 'CIP · Business',
  tags: ['business'],
  description:
    'Orders, revenue and conversion from Prometheus: orders_placed_total{currency,attributed}, orders_paid_total{currency}, order_revenue_cents_total{currency}, checkout_failures_total{reason} (API) and collector_events_by_type_total{event_type} (collector)',
  refresh: '30s',
  panels: [
    stat('Orders placed (range)', `round(${placed('$__range')})`, { decimals: 0, color: 'blue' }),
    stat('Orders / min', `sum(rate(orders_placed_total{${P}}[5m])) * 60`, { decimals: 1, color: 'blue' }),
    stat('Revenue (range)', `sum by (currency) (increase(order_revenue_cents_total{${P}}[$__range])) / 100`, {
      decimals: 2,
      color: 'green',
      legend: '{{currency}}',
      description: 'Paid revenue per currency (payment webhook)',
    }),
    stat('Paid orders (range)', `round(sum(increase(orders_paid_total{${P}}[$__range])))`, {
      decimals: 0,
      color: 'green',
    }),
    stat(
      'Conversion (orders / product views)',
      `${placed('$__range')} / ${tracked('product_viewed', '$__range')}`,
      {
        unit: 'percentunit',
        decimals: 2,
        color: 'purple',
        description: 'Orders placed divided by tracked product_viewed events over the selected range',
      },
    ),
    stat(
      'Checkout failure share',
      `sum(increase(checkout_failures_total{${P}}[$__range])) / (sum(increase(checkout_failures_total{${P}}[$__range])) + ${placed('$__range')})`,
      {
        unit: 'percentunit',
        decimals: 1,
        description: 'Failed checkouts (any reason, incl. out of stock) / all checkout attempts',
        thresholds: [
          { color: 'green', value: null },
          { color: 'orange', value: 0.1 },
          { color: 'red', value: 0.3 },
        ],
      },
    ),
    row('Orders and revenue'),
    ts(
      'Orders per minute',
      [
        target(`sum by (currency) (rate(orders_placed_total{${P}}[5m])) * 60`, 'placed {{currency}}'),
        target(`sum by (currency) (rate(orders_paid_total{${P}}[5m])) * 60`, 'paid {{currency}}'),
      ],
      { min: 0 },
    ),
    ts(
      'Revenue per minute by currency',
      [target(`sum by (currency) (rate(order_revenue_cents_total{${P}}[5m])) * 60 / 100`, '{{currency}}')],
      { min: 0 },
    ),
    ts(
      'Average order value by currency',
      [
        target(
          `sum by (currency) (rate(order_revenue_cents_total{${P}}[15m])) / sum by (currency) (rate(orders_paid_total{${P}}[15m])) / 100`,
          '{{currency}}',
        ),
      ],
      { w: 8 },
    ),
    ts(
      'Attributed vs unattributed orders',
      [target(`sum by (attributed) (rate(orders_placed_total{${P}}[5m])) * 60`, 'attributed={{attributed}}')],
      { stack: true, w: 8, description: 'Orders attributed to a personalization decision (per minute)' },
    ),
    ts(
      'Paid / placed ratio',
      [
        target(
          `sum(rate(orders_paid_total{${P}}[15m])) / sum(rate(orders_placed_total{${P}}[15m]))`,
          'paid / placed',
        ),
      ],
      { unit: 'percentunit', w: 8, description: 'Declined cards and expired reservations lower it' },
    ),
    row('Checkout'),
    ts(
      'Checkout failures by reason',
      [target(`sum by (reason) (rate(checkout_failures_total{${P}}[5m])) * 60`, '{{reason}}')],
      {
        stack: true,
        w: 8,
        description: 'Per minute; reason = Problem code (INSUFFICIENT_STOCK, CART_EMPTY, …)',
      },
    ),
    ts(
      'Checkout responses by status',
      [
        target(
          `sum by (status) (rate(http_requests_total{${P}, route="/v1/storefront/checkout", method="POST"}[1m]))`,
          '{{status}}',
        ),
      ],
      { stack: true, unit: 'reqps', w: 8 },
    ),
    ts(
      'Checkout latency',
      [
        target(q(0.5, 'http_request_duration_seconds', [], `${P}, route="/v1/storefront/checkout"`), 'p50'),
        target(q(0.95, 'http_request_duration_seconds', [], `${P}, route="/v1/storefront/checkout"`), 'p95'),
        target(q(0.99, 'http_request_duration_seconds', [], `${P}, route="/v1/storefront/checkout"`), 'p99'),
      ],
      { unit: 's', w: 8 },
    ),
    ts(
      'Payments',
      [
        target(
          `sum by (status) (rate(http_requests_total{${P}, route="/v1/payments/fake/:intentId/confirm"}[5m])) * 60`,
          'confirm {{status}} /min',
        ),
        target(
          `sum by (status) (rate(http_requests_total{${P}, route="/v1/payments/webhooks/:provider"}[5m])) * 60`,
          'webhook {{status}} /min',
        ),
        target(`sum(rate(reservations_expired_orders_total{${P}}[5m])) * 60`, 'expired reservations /min'),
      ],
      { w: 12 },
    ),
    ts(
      'Merchant webhooks',
      [target(`sum by (outcome) (rate(webhook_deliveries_total{${P}}[5m])) * 60`, '{{outcome}}')],
      { description: 'Outgoing webhook deliveries per minute' },
    ),
    row('Funnel and tracking'),
    ts(
      'Tracked funnel (per minute)',
      [
        target(`${tracked('page_viewed', '5m')} / 5`, 'page_viewed'),
        target(`${tracked('product_viewed', '5m')} / 5`, 'product_viewed'),
        target(`${tracked('cart_item_added', '5m')} / 5`, 'cart_item_added'),
        target(`${tracked('checkout_started', '5m')} / 5`, 'checkout_started'),
        target(`${placed('5m')} / 5`, 'orders placed'),
      ],
      { description: 'Accepted tracking events by type (collector) and orders placed (API)' },
    ),
    ts(
      'Step conversion (15 min windows)',
      [
        target(`${tracked('cart_item_added', '15m')} / ${tracked('product_viewed', '15m')}`, 'view → cart'),
        target(
          `${tracked('checkout_started', '15m')} / ${tracked('cart_item_added', '15m')}`,
          'cart → checkout',
        ),
        target(`${placed('15m')} / ${tracked('checkout_started', '15m')}`, 'checkout → order'),
        target(`${placed('15m')} / ${tracked('product_viewed', '15m')}`, 'view → order'),
        target(`${placed('15m')} / ${tracked('page_viewed', '15m')}`, 'page view → order (session proxy)'),
      ],
      { unit: 'percentunit' },
    ),
    ts(
      'Tracked event mix',
      [target(`sum by (event_type) (rate(collector_events_by_type_total{${P}}[1m]))`, '{{event_type}}')],
      { stack: true, unit: 'short', description: 'Accepted events per second by type' },
    ),
    bar(
      'Event mix share (range)',
      `sum by (event_type) (increase(collector_events_by_type_total{${P}}[$__range])) / scalar(sum(increase(collector_events_by_type_total{${P}}[$__range])))`,
      '{{event_type}}',
      { unit: 'percentunit' },
    ),
    ts(
      'Ad attribution (bandit feedback)',
      [
        target(
          `sum by (event_type, outcome) (rate(bandit_feedback_total{${P}, event_type=~"ad_.+|order.placed"}[5m])) * 60`,
          '{{event_type}} {{outcome}}',
        ),
      ],
      { description: 'Impressions, clicks and orders attributed to a decision (per minute)' },
    ),
    ts('Tracked events/s by producer', [
      target(`sum by (outcome) (rate(collector_events_total{${P}}[1m]))`, 'collector {{outcome}}'),
      target(
        `sum by (store, status) (rate(simulator_events_sent_total{${P}}[1m]))`,
        'simulator {{store}} {{status}}',
      ),
    ]),
  ],
});

const personalization = dashboard({
  uid: 'cip-personalization',
  title: 'CIP · Personalization',
  tags: ['personalization', 'llm', 'bandit'],
  description: 'Decision API, recommendations, profiles, bandit feedback and LLM usage',
  panels: [
    stat('Decision p95', q(0.95, 'decision_latency_seconds', [], P), {
      unit: 's',
      thresholds: [
        { color: 'green', value: null },
        { color: 'red', value: 0.05 },
      ],
    }),
    stat('Decisions/s', `sum(rate(decisions_total{${P}}[1m]))`, { decimals: 1, color: 'blue', w: 3 }),
    stat(
      'Cold-start share',
      `sum(rate(decisions_total{${P}, cold_start="true"}[5m])) / sum(rate(decisions_total{${P}}[5m]))`,
      {
        unit: 'percentunit',
        decimals: 1,
        color: 'purple',
        w: 3,
      },
    ),
    stat(
      'Thompson share',
      `sum(rate(decisions_total{${P}, policy="thompson_sampling"}[5m])) / sum(rate(decisions_total{${P}}[5m]))`,
      {
        unit: 'percentunit',
        decimals: 1,
        color: 'blue',
        w: 3,
        description: 'Decisions served by Thompson sampling (rest: warmup and holdout)',
      },
    ),
    stat('Recommendation p95', q(0.95, 'recommendation_latency_seconds', [], P), {
      unit: 's',
      thresholds: [
        { color: 'green', value: null },
        { color: 'red', value: 0.1 },
      ],
    }),
    stat('LLM cost (range)', `sum(increase(llm_cost_usd_total{${P}}[$__range]))`, {
      unit: 'currencyUSD',
      decimals: 4,
      color: 'orange',
    }),
    stat(
      'LLM error ratio',
      `sum(rate(llm_requests_total{${P}, outcome=~"error|invalid_output"}[15m])) / sum(rate(llm_requests_total{${P}}[15m]))`,
      {
        unit: 'percentunit',
        decimals: 1,
        w: 3,
        thresholds: [
          { color: 'green', value: null },
          { color: 'red', value: 0.05 },
        ],
      },
    ),
    row('Decision API'),
    ts(
      'Decision latency (p50 / p95 / p99)',
      [
        target(q(0.5, 'decision_latency_seconds', [], P), 'p50'),
        target(q(0.95, 'decision_latency_seconds', [], P), 'p95'),
        target(q(0.99, 'decision_latency_seconds', [], P), 'p99'),
      ],
      { unit: 's', thresholdLine: 0.05, description: 'Target p95 < 50 ms' },
    ),
    ts(
      'Decision p95 by placement',
      [target(q(0.95, 'decision_latency_seconds', ['placement'], P), '{{placement}}')],
      {
        unit: 's',
        thresholdLine: 0.05,
      },
    ),
    ts(
      'Policy share (holdout vs Thompson sampling)',
      [
        target(
          `sum by (policy) (rate(decisions_total{${P}}[5m])) / scalar(sum(rate(decisions_total{${P}}[5m])))`,
          '{{policy}}',
        ),
      ],
      {
        unit: 'percentunit',
        stack: true,
        w: 8,
        description: 'Share of decisions per policy (warmup, thompson_sampling, holdout_uniform)',
      },
    ),
    ts(
      'Decisions by segment',
      [target(`sum by (segment) (rate(decisions_total{${P}}[1m]))`, '{{segment}}')],
      { stack: true, w: 8 },
    ),
    bar(
      'Segment distribution of decisions (range)',
      `sum by (segment) (increase(decisions_total{${P}}[$__range])) / scalar(sum(increase(decisions_total{${P}}[$__range])))`,
      '{{segment}}',
      { unit: 'percentunit', w: 8 },
    ),
    ts(
      'Decisions by placement and cold start',
      [
        target(
          `sum by (placement, cold_start) (rate(decisions_total{${P}}[1m]))`,
          '{{placement}} cold={{cold_start}}',
        ),
      ],
      { stack: true, w: 8 },
    ),
    ts(
      'Policy by segment',
      [target(`sum by (segment, policy) (rate(decisions_total{${P}}[5m]))`, '{{segment}} {{policy}}')],
      { w: 8 },
    ),
    ts(
      'Decision log',
      [
        target(`sum by (outcome) (rate(decisions_published_total{${P}}[1m]))`, 'published {{outcome}}'),
        target(`sum(rate(decisions_logged_total{${P}}[1m]))`, 'logged to ClickHouse'),
      ],
      { w: 8 },
    ),
    row('Bandit and profiles'),
    ts(
      'Bandit feedback',
      [
        target(
          `sum by (event_type, outcome) (rate(bandit_feedback_total{${P}}[1m]))`,
          '{{event_type}} {{outcome}}',
        ),
      ],
      {
        w: 8,
      },
    ),
    ts(
      'Profile events applied',
      [
        target(`sum by (kind) (rate(profile_events_applied_total{${P}}[1m]))`, '{{kind}}'),
        target(`sum(rate(profile_merges_total{${P}}[5m]))`, 'merges'),
      ],
      { w: 8 },
    ),
    ts(
      'Profile update p95 and snapshots',
      [
        target(q(0.95, 'profile_update_seconds', [], P), 'Lua update p95 (s)'),
        target(`sum(rate(profile_snapshots_total{${P}}[5m]))`, 'profile snapshots/s'),
        target(`sum(rate(bandit_snapshots_total{${P}}[5m]))`, 'bandit snapshots/s'),
      ],
      { w: 8 },
    ),
    row('Recommendations'),
    ts(
      'Recommendation latency p95 by type',
      [target(q(0.95, 'recommendation_latency_seconds', ['type'], P), '{{type}}')],
      {
        unit: 's',
        w: 8,
      },
    ),
    ts(
      'Recommendations by type and cache',
      [target(`sum by (type, cache) (rate(recommendations_total{${P}}[1m]))`, '{{type}} {{cache}}')],
      {
        stack: true,
        w: 8,
      },
    ),
    ts(
      'Co-occurrence and refresh',
      [
        target(`sum by (source) (rate(reco_cooccurrence_pairs_total{${P}}[1m]))`, 'pairs {{source}}'),
        target(`sum by (kind) (rate(reco_refresh_total{${P}}[5m]))`, 'refresh {{kind}}'),
      ],
      { w: 8 },
    ),
    row('LLM and embeddings'),
    ts(
      'LLM requests',
      [
        target(
          `sum by (provider, task, outcome) (rate(llm_requests_total{${P}}[5m])) * 60`,
          '{{provider}} {{task}} {{outcome}}',
        ),
      ],
      {
        w: 8,
        description: 'Requests per minute',
      },
    ),
    ts(
      'LLM cost (USD per hour)',
      [
        target(
          `sum by (provider, task) (rate(llm_cost_usd_total{${P}}[15m])) * 3600`,
          '{{provider}} {{task}}',
        ),
      ],
      {
        unit: 'currencyUSD',
        w: 8,
      },
    ),
    ts(
      'LLM tokens per minute',
      [
        target(
          `sum by (provider, direction) (rate(llm_tokens_total{${P}}[5m])) * 60`,
          '{{provider}} {{direction}}',
        ),
      ],
      {
        w: 8,
      },
    ),
    ts(
      'LLM latency p95',
      [target(q(0.95, 'llm_latency_seconds', ['provider', 'task'], P, '15m'), '{{provider}} {{task}}')],
      {
        unit: 's',
        w: 8,
      },
    ),
    ts(
      'Product embeddings',
      [
        target(
          `sum by (provider, outcome) (rate(product_embeddings_total{${P}}[5m])) * 60`,
          '{{provider}} {{outcome}} /min',
        ),
        target(
          `sum by (status) (rate(embeddings_requests_total{${P}}[5m])) * 60`,
          'embeddings-server {{status}} /min',
        ),
      ],
      { w: 8 },
    ),
    ts(
      'Embedding latency p95',
      [
        target(q(0.95, 'embedding_request_seconds', ['provider'], P), 'client {{provider}}'),
        target(q(0.95, 'embedding_inference_seconds', [], P), 'embeddings-server inference'),
      ],
      { unit: 's', w: 8 },
    ),
    text(
      'Notes',
      'Decision target: p95 < 50 ms (alert `CipDecisionLatencyP95High`). Segment, policy and cold-start labels come from `decisions_total{placement,policy,cold_start,segment}`; per-decision detail is in the ClickHouse `decisions` table.',
    ),
  ],
});

const dashboards = {
  'system-overview.json': systemOverview,
  'event-pipeline.json': eventPipeline,
  'business.json': business,
  'personalization.json': personalization,
};

function alertRule({
  uid,
  title,
  expr,
  op = 'gt',
  threshold,
  forDuration,
  severity,
  summary,
  dashboardUid,
  noData = 'OK',
}) {
  return {
    uid,
    title,
    condition: 'C',
    data: [
      {
        refId: 'A',
        relativeTimeRange: { from: 600, to: 0 },
        datasourceUid: 'prometheus',
        model: { refId: 'A', expr, instant: true, range: false, intervalMs: 15000, maxDataPoints: 43200 },
      },
      {
        refId: 'C',
        relativeTimeRange: { from: 0, to: 0 },
        datasourceUid: '__expr__',
        model: {
          refId: 'C',
          type: 'threshold',
          expression: 'A',
          conditions: [{ evaluator: { type: op, params: [threshold] } }],
        },
      },
    ],
    noDataState: noData,
    execErrState: 'Error',
    for: forDuration,
    labels: { severity, team: 'cip' },
    annotations: {
      summary,
      ...(dashboardUid ? { dashboard: `http://127.0.0.1:4192/d/${dashboardUid}` } : {}),
    },
    isPaused: false,
  };
}

const MAIN_QUEUES_RAW = 'queue=~"q\\\\.[a-z.]+", queue!~".*\\\\.(dlq|retry\\\\..+)"';
const alertGroups = {
  apiVersion: 1,
  groups: [
    {
      orgId: 1,
      name: 'cip-pipeline',
      folder: 'Commerce Intelligence',
      interval: '20s',
      rules: [
        alertRule({
          uid: 'cip-dlq-not-empty',
          title: 'DLQ has messages',
          expr: 'sum by (vhost, queue) (rabbitmq_queue_messages{queue=~"q\\\\..+\\\\.dlq"})',
          threshold: 0,
          forDuration: '5m',
          severity: 'warning',
          summary:
            'Dead-letter queue {{ $labels.queue }} ({{ $labels.vhost }}) is not empty: replay from Platform admin → DLQ',
          dashboardUid: 'cip-event-pipeline',
        }),
        alertRule({
          uid: 'cip-freshness-p95',
          title: 'Event freshness p95 above 10s',
          expr: 'histogram_quantile(0.95, sum by (profile, queue, le) (rate(message_end_to_end_seconds_bucket[5m])))',
          threshold: 10,
          forDuration: '5m',
          severity: 'warning',
          summary: 'p95 end-to-end freshness of {{ $labels.queue }} ({{ $labels.profile }}) is above 10 s',
          dashboardUid: 'cip-event-pipeline',
        }),
        alertRule({
          uid: 'cip-outbox-stale',
          title: 'Outbox rows unpublished for more than 1 minute',
          expr: 'max by (profile) (outbox_oldest_unpublished_seconds)',
          threshold: 60,
          forDuration: '1m',
          severity: 'critical',
          summary: 'Outbox of {{ $labels.profile }} has rows older than 60 s (relay or broker down)',
          dashboardUid: 'cip-event-pipeline',
        }),
        alertRule({
          uid: 'cip-queue-backlog-growing',
          title: 'Consumer lag: queue backlog growing',
          expr: `(sum by (vhost, queue) (rabbitmq_queue_messages{${MAIN_QUEUES_RAW}}) > 500) and (sum by (vhost, queue) (deriv(rabbitmq_queue_messages{${MAIN_QUEUES_RAW}}[2m])) > 0)`,
          threshold: 500,
          forDuration: '1m',
          severity: 'warning',
          summary: 'Backlog of {{ $labels.queue }} ({{ $labels.vhost }}) is above 500 and still growing',
          dashboardUid: 'cip-event-pipeline',
        }),
        alertRule({
          uid: 'cip-collector-buffering',
          title: 'Collector buffering events (broker unavailable)',
          expr: 'max by (profile) (collector_buffer_size)',
          threshold: 0,
          forDuration: '30s',
          severity: 'warning',
          summary: 'Collector of {{ $labels.profile }} holds events in memory',
          dashboardUid: 'cip-event-pipeline',
        }),
        alertRule({
          uid: 'cip-rabbitmq-down',
          title: 'RabbitMQ unreachable',
          expr: 'max(rabbitmq_up)',
          op: 'lt',
          threshold: 1,
          forDuration: '30s',
          severity: 'critical',
          summary: 'RabbitMQ management API does not answer the exporter',
          noData: 'NoData',
        }),
      ],
    },
    {
      orgId: 1,
      name: 'cip-services',
      folder: 'Commerce Intelligence',
      interval: '20s',
      rules: [
        alertRule({
          uid: 'cip-http-5xx',
          title: '5xx rate above 1%',
          expr: '(sum by (profile, service) (rate(http_requests_total{status=~"5.."}[5m])) / sum by (profile, service) (rate(http_requests_total[5m]))) or (sum by (profile, service) (rate(collector_request_duration_seconds_count{status=~"5.."}[5m])) / sum by (profile, service) (rate(collector_request_duration_seconds_count[5m])))',
          threshold: 0.01,
          forDuration: '5m',
          severity: 'critical',
          summary: '{{ $labels.service }} ({{ $labels.profile }}) answers more than 1 % 5xx',
          dashboardUid: 'cip-system-overview',
        }),
        alertRule({
          uid: 'cip-checkout-server-errors',
          title: 'Checkout server-side failures above 1%',
          expr: 'sum by (profile) (rate(checkout_failures_total{reason=~"error|SERVICE_UNAVAILABLE|CONFLICT"}[5m])) / (sum by (profile) (rate(checkout_failures_total[5m])) + sum by (profile) (rate(orders_placed_total[5m])))',
          threshold: 0.01,
          forDuration: '5m',
          severity: 'critical',
          summary:
            'Checkout of {{ $labels.profile }} fails server-side for more than 1 % of attempts (stock conflicts excluded)',
          dashboardUid: 'cip-business',
        }),
        alertRule({
          uid: 'cip-decision-p95',
          title: 'Decision API p95 above 50ms',
          expr: 'histogram_quantile(0.95, sum by (profile, le) (rate(decision_latency_seconds_bucket[5m])))',
          threshold: 0.05,
          forDuration: '5m',
          severity: 'warning',
          summary: 'Decision API p95 of {{ $labels.profile }} is above 50 ms',
          dashboardUid: 'cip-personalization',
        }),
        alertRule({
          uid: 'cip-service-down',
          title: 'Service of a running stack is down',
          expr: '(up{job=~"cip-.+", service!~"simulator|embeddings-server"} == 0) and on (profile) (max by (profile) (up{job=~"cip-.+", service!~"simulator|embeddings-server"}) == 1)',
          op: 'gt',
          threshold: -1,
          forDuration: '30s',
          severity: 'critical',
          summary: '{{ $labels.service }} of the {{ $labels.profile }} stack does not answer /metrics',
          dashboardUid: 'cip-system-overview',
        }),
        alertRule({
          uid: 'cip-event-loop-lag',
          title: 'Event loop lag p99 above 200ms',
          expr: 'max by (profile, service) (nodejs_eventloop_lag_p99_seconds)',
          threshold: 0.2,
          forDuration: '2m',
          severity: 'warning',
          summary: '{{ $labels.service }} ({{ $labels.profile }}) event loop is blocked',
          dashboardUid: 'cip-system-overview',
        }),
      ],
    },
  ],
};

const alertFile = join(here, 'provisioning', 'alerting', 'cip-alerts.json');
mkdirSync(dirname(alertFile), { recursive: true });
writeFileSync(alertFile, `${JSON.stringify(alertGroups, null, 2)}\n`);
process.stdout.write(
  `grafana: wrote provisioning/alerting/cip-alerts.json (${alertGroups.groups.reduce((n, g) => n + g.rules.length, 0)} rules)\n`,
);

const outDir = join(here, 'dashboards');
mkdirSync(outDir, { recursive: true });
for (const [file, body] of Object.entries(dashboards)) {
  writeFileSync(join(outDir, file), `${JSON.stringify(body, null, 2)}\n`);
  process.stdout.write(`grafana: wrote ${file} (${body.panels.length} panels)\n`);
}
