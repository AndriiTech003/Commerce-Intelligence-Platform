import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const QUEUE_GAUGES = [
  ['rabbitmq_queue_messages_ready', 'Messages ready to be delivered', (q) => q.messages_ready],
  [
    'rabbitmq_queue_messages_unacked',
    'Messages delivered but not yet acknowledged',
    (q) => q.messages_unacknowledged,
  ],
  ['rabbitmq_queue_messages', 'Messages ready plus unacknowledged', (q) => q.messages],
  ['rabbitmq_queue_consumers', 'Consumers on the queue', (q) => q.consumers],
];

const QUEUE_COUNTERS = [
  [
    'rabbitmq_queue_messages_published_total',
    'Messages published into the queue',
    (q) => q.message_stats?.publish,
  ],
  [
    'rabbitmq_queue_messages_delivered_total',
    'Messages delivered to consumers',
    (q) => q.message_stats?.deliver_get,
  ],
  ['rabbitmq_queue_messages_acked_total', 'Messages acknowledged by consumers', (q) => q.message_stats?.ack],
  ['rabbitmq_queue_messages_redelivered_total', 'Messages redelivered', (q) => q.message_stats?.redeliver],
];

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function line(name, labels, value) {
  const rendered = Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',');
  return `${name}${rendered ? `{${rendered}}` : ''} ${Number.isFinite(value) ? value : 0}`;
}

export function renderQueues(queues, vhostPattern) {
  const out = [];
  const selected = queues.filter((q) => vhostPattern.test(q.vhost));
  for (const [name, help, pick] of QUEUE_GAUGES) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const q of selected) out.push(line(name, { vhost: q.vhost, queue: q.name }, Number(pick(q) ?? 0)));
  }
  for (const [name, help, pick] of QUEUE_COUNTERS) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const q of selected) out.push(line(name, { vhost: q.vhost, queue: q.name }, Number(pick(q) ?? 0)));
  }
  return out;
}

export function createExporter({
  managementUrl = 'http://127.0.0.1:15672',
  username = 'guest',
  password = 'guest',
  vhostPattern = /^cip/,
  timeoutMs = 4000,
} = {}) {
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const columns = [
    'name',
    'vhost',
    'messages',
    'messages_ready',
    'messages_unacknowledged',
    'consumers',
    'message_stats.publish',
    'message_stats.deliver_get',
    'message_stats.ack',
    'message_stats.redeliver',
  ].join(',');
  return async function scrape() {
    const started = process.hrtime.bigint();
    const out = [];
    let up = 0;
    try {
      const response = await fetch(`${managementUrl}/api/queues?columns=${columns}`, {
        headers: { authorization: auth },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`management API returned ${response.status}`);
      out.push(...renderQueues(await response.json(), vhostPattern));
      up = 1;
    } catch (error) {
      out.push(
        `# exporter error: ${error instanceof Error ? error.message : String(error)}`.replace(/\n/g, ' '),
      );
    }
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    out.push(
      '# HELP rabbitmq_up Whether the RabbitMQ management API answered the last scrape',
      '# TYPE rabbitmq_up gauge',
      line('rabbitmq_up', {}, up),
      '# HELP rabbitmq_exporter_scrape_seconds Duration of the management API call',
      '# TYPE rabbitmq_exporter_scrape_seconds gauge',
      line('rabbitmq_exporter_scrape_seconds', {}, seconds),
    );
    return `${out.join('\n')}\n`;
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.RABBITMQ_EXPORTER_PORT ?? 4197);
  const host = process.env.RABBITMQ_EXPORTER_HOST ?? '127.0.0.1';
  const scrape = createExporter({
    managementUrl: process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672',
    username: process.env.RABBITMQ_MANAGEMENT_USER ?? 'guest',
    password: process.env.RABBITMQ_MANAGEMENT_PASSWORD ?? 'guest',
    vhostPattern: new RegExp(process.env.RABBITMQ_EXPORTER_VHOSTS ?? '^cip'),
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
    process.stdout.write(`rabbitmq-exporter: http://${host}:${port}/metrics\n`),
  );
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
