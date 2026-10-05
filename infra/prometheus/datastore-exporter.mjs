import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function line(name, labels, value) {
  const rendered = Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',');
  const numeric = Number(value);
  return `${name}${rendered ? `{${rendered}}` : ''} ${Number.isFinite(numeric) ? numeric : 0}`;
}

class Metrics {
  constructor() {
    this.families = new Map();
  }

  add(name, type, help, labels, value) {
    if (!this.families.has(name)) this.families.set(name, { type, help, samples: [] });
    this.families.get(name).samples.push(line(name, labels, value));
  }

  render() {
    const out = [];
    for (const [name, family] of this.families) {
      out.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} ${family.type}`, ...family.samples);
    }
    return `${out.join('\n')}\n`;
  }
}

export async function scrapePostgres(metrics, { url, databasePattern, timeoutMs }) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
  });
  await client.connect();
  try {
    const stats = await client.query(
      `select datname, xact_commit, xact_rollback, blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted,
              tup_updated, tup_deleted, deadlocks, temp_bytes, pg_database_size(datname) as size_bytes
         from pg_stat_database where datname ~ $1`,
      [databasePattern],
    );
    for (const r of stats.rows) {
      const l = { datname: r.datname };
      metrics.add('pg_database_size_bytes', 'gauge', 'Database size on disk', l, r.size_bytes);
      metrics.add(
        'pg_stat_database_xact_commit_total',
        'counter',
        'Committed transactions',
        l,
        r.xact_commit,
      );
      metrics.add(
        'pg_stat_database_xact_rollback_total',
        'counter',
        'Rolled back transactions',
        l,
        r.xact_rollback,
      );
      metrics.add('pg_stat_database_blks_read_total', 'counter', 'Blocks read from disk', l, r.blks_read);
      metrics.add(
        'pg_stat_database_blks_hit_total',
        'counter',
        'Blocks found in shared buffers',
        l,
        r.blks_hit,
      );
      metrics.add(
        'pg_stat_database_tup_returned_total',
        'counter',
        'Rows returned by queries',
        l,
        r.tup_returned,
      );
      metrics.add('pg_stat_database_tup_inserted_total', 'counter', 'Rows inserted', l, r.tup_inserted);
      metrics.add('pg_stat_database_tup_updated_total', 'counter', 'Rows updated', l, r.tup_updated);
      metrics.add('pg_stat_database_tup_deleted_total', 'counter', 'Rows deleted', l, r.tup_deleted);
      metrics.add('pg_stat_database_deadlocks_total', 'counter', 'Deadlocks detected', l, r.deadlocks);
      metrics.add(
        'pg_stat_database_temp_bytes_total',
        'counter',
        'Bytes written to temporary files',
        l,
        r.temp_bytes,
      );
    }
    const activity = await client.query(
      `select datname, coalesce(state, 'unknown') as state, count(*)::int as n
         from pg_stat_activity where datname ~ $1 group by 1, 2`,
      [databasePattern],
    );
    for (const r of activity.rows)
      metrics.add(
        'pg_stat_activity_count',
        'gauge',
        'Connections by state',
        { datname: r.datname, state: r.state },
        r.n,
      );
    const waiting = await client.query(
      `select d.datname, count(*)::int as n from pg_locks l join pg_database d on d.oid = l.database
        where not l.granted and d.datname ~ $1 group by 1`,
      [databasePattern],
    );
    for (const r of waiting.rows)
      metrics.add(
        'pg_locks_waiting',
        'gauge',
        'Lock requests waiting to be granted',
        { datname: r.datname },
        r.n,
      );
    const settings = await client.query(`select setting from pg_settings where name = 'max_connections'`);
    metrics.add('pg_settings_max_connections', 'gauge', 'max_connections', {}, settings.rows[0]?.setting);
  } finally {
    await client.end();
  }
}

export function parseRedisInfo(text) {
  const info = {};
  for (const raw of text.split('\n')) {
    const entry = raw.trim();
    if (!entry || entry.startsWith('#')) continue;
    const index = entry.indexOf(':');
    if (index > 0) info[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return info;
}

function redisInfo({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const chunks = [];
    let expected = null;
    let received = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('redis INFO timed out'));
    }, timeoutMs);
    socket.on('connect', () => socket.write('*1\r\n$4\r\nINFO\r\n'));
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      const buffer = Buffer.concat(chunks);
      if (expected === null) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        if (buffer[0] !== 0x24) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`unexpected redis reply ${buffer.subarray(0, end).toString()}`));
          return;
        }
        expected = Number(buffer.subarray(1, end).toString()) + end + 4;
      }
      if (received >= expected) {
        clearTimeout(timer);
        socket.end();
        const start = buffer.indexOf('\r\n') + 2;
        resolve(buffer.subarray(start, start + expected - start - 2).toString());
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function scrapeRedis(metrics, options) {
  const info = parseRedisInfo(await redisInfo(options));
  metrics.add('redis_connected_clients', 'gauge', 'Connected clients', {}, info.connected_clients);
  metrics.add('redis_blocked_clients', 'gauge', 'Clients blocked on a command', {}, info.blocked_clients);
  metrics.add('redis_memory_used_bytes', 'gauge', 'Memory used by Redis', {}, info.used_memory);
  metrics.add(
    'redis_commands_processed_total',
    'counter',
    'Commands processed',
    {},
    info.total_commands_processed,
  );
  metrics.add('redis_keyspace_hits_total', 'counter', 'Successful key lookups', {}, info.keyspace_hits);
  metrics.add('redis_keyspace_misses_total', 'counter', 'Failed key lookups', {}, info.keyspace_misses);
  metrics.add('redis_evicted_keys_total', 'counter', 'Keys evicted', {}, info.evicted_keys);
  metrics.add('redis_expired_keys_total', 'counter', 'Keys expired', {}, info.expired_keys);
  metrics.add(
    'redis_instantaneous_ops_per_sec',
    'gauge',
    'Operations per second (Redis sample)',
    {},
    info.instantaneous_ops_per_sec,
  );
  for (const [key, value] of Object.entries(info)) {
    const match = /^db(\d+)$/.exec(key);
    if (!match) continue;
    const fields = Object.fromEntries(value.split(',').map((kv) => kv.split('=')));
    metrics.add('redis_db_keys', 'gauge', 'Keys per logical database', { db: `db${match[1]}` }, fields.keys);
    metrics.add(
      'redis_db_keys_expiring',
      'gauge',
      'Keys with a TTL per logical database',
      { db: `db${match[1]}` },
      fields.expires,
    );
  }
}

async function clickhouse(url, query, timeoutMs) {
  const response = await fetch(
    `${url.replace(/\/$/, '')}/?query=${encodeURIComponent(`${query} FORMAT JSON`)}`,
    {
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok)
    throw new Error(`clickhouse returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).data;
}

export async function scrapeClickHouse(metrics, { url, databasePattern, timeoutMs }) {
  const current = await clickhouse(
    url,
    `select metric, value from system.metrics where metric in ('Query','TCPConnection','HTTPConnection','MemoryTracking','BackgroundMergesAndMutationsPoolTask')`,
    timeoutMs,
  );
  for (const r of current)
    metrics.add('clickhouse_metric', 'gauge', 'ClickHouse system.metrics', { metric: r.metric }, r.value);
  const events = await clickhouse(
    url,
    `select event, value from system.events where event in ('Query','SelectQuery','InsertQuery','FailedQuery','InsertedRows','SelectedRows','MergedRows')`,
    timeoutMs,
  );
  for (const r of events)
    metrics.add('clickhouse_event_total', 'counter', 'ClickHouse system.events', { event: r.event }, r.value);
  const parts = await clickhouse(
    url,
    `select database, table, sum(rows) as rows, sum(bytes_on_disk) as bytes, count() as parts
       from system.parts where active and match(database, '${databasePattern.replace(/'/g, '')}') group by database, table`,
    timeoutMs,
  );
  for (const r of parts) {
    const l = { database: r.database, table: r.table };
    metrics.add('clickhouse_table_rows', 'gauge', 'Rows in active parts', l, r.rows);
    metrics.add('clickhouse_table_bytes', 'gauge', 'Bytes on disk of active parts', l, r.bytes);
    metrics.add('clickhouse_table_parts', 'gauge', 'Active parts', l, r.parts);
  }
}

export function createExporter({
  postgresUrl = 'postgres://127.0.0.1:5432/postgres',
  redisHost = '127.0.0.1',
  redisPort = 6379,
  clickhouseUrl = 'http://127.0.0.1:8123',
  databasePattern = '^cip',
  timeoutMs = 4000,
} = {}) {
  const targets = [
    ['postgres', 'pg_up', (m) => scrapePostgres(m, { url: postgresUrl, databasePattern, timeoutMs })],
    ['redis', 'redis_up', (m) => scrapeRedis(m, { host: redisHost, port: redisPort, timeoutMs })],
    [
      'clickhouse',
      'clickhouse_up',
      (m) => scrapeClickHouse(m, { url: clickhouseUrl, databasePattern, timeoutMs }),
    ],
  ];
  return async function scrape() {
    const metrics = new Metrics();
    const errors = [];
    const ups = await Promise.all(
      targets.map(async ([name, upMetric, fn]) => {
        const started = process.hrtime.bigint();
        try {
          await fn(metrics);
          return [name, upMetric, 1, Number(process.hrtime.bigint() - started) / 1e9];
        } catch (error) {
          errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          return [name, upMetric, 0, Number(process.hrtime.bigint() - started) / 1e9];
        }
      }),
    );
    for (const [name, upMetric, up, seconds] of ups) {
      metrics.add(upMetric, 'gauge', `Whether the last ${name} scrape succeeded`, {}, up);
      metrics.add(
        'datastore_exporter_scrape_seconds',
        'gauge',
        'Duration of each datastore scrape',
        { datastore: name },
        seconds,
      );
    }
    const body = metrics.render();
    return errors.length
      ? `${body}${errors.map((e) => `# exporter error: ${e.replace(/\n/g, ' ')}`).join('\n')}\n`
      : body;
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.DATASTORE_EXPORTER_PORT ?? 4196);
  const host = process.env.DATASTORE_EXPORTER_HOST ?? '127.0.0.1';
  const scrape = createExporter({
    postgresUrl: process.env.DATASTORE_PG_URL ?? 'postgres://127.0.0.1:5432/postgres',
    redisHost: process.env.DATASTORE_REDIS_HOST ?? '127.0.0.1',
    redisPort: Number(process.env.DATASTORE_REDIS_PORT ?? 6379),
    clickhouseUrl: process.env.DATASTORE_CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
    databasePattern: process.env.DATASTORE_DATABASES ?? '^cip',
  });
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      scrape().then(
        (body) => {
          res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
          res.end(body);
        },
        (error) => {
          res.writeHead(500);
          res.end(String(error));
        },
      );
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, host, () =>
    process.stdout.write(`datastore-exporter: http://${host}:${port}/metrics\n`),
  );
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
