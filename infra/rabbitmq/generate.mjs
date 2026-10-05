import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELIVERY_LIMIT,
  EXCHANGES,
  QUEUES,
  RETRY_DELAYS,
  RETRY_DELAY_MS,
  dlqName,
  queueName,
  retryQueueName,
} from '../../packages/contracts/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export function buildDefinitions() {
  const exchanges = [
    { name: EXCHANGES.track, type: 'topic' },
    { name: EXCHANGES.domain, type: 'topic' },
    { name: EXCHANGES.retry, type: 'direct' },
    { name: EXCHANGES.dlx, type: 'direct' },
  ].map((e) => ({ ...e, durable: true, auto_delete: false, internal: false, arguments: {} }));
  const queues = [];
  const bindings = [];
  for (const q of QUEUES) {
    queues.push({
      name: queueName(q.name),
      durable: true,
      auto_delete: false,
      arguments: {
        'x-queue-type': 'quorum',
        'x-delivery-limit': DELIVERY_LIMIT,
        'x-dead-letter-exchange': EXCHANGES.dlx,
        'x-dead-letter-routing-key': q.name,
      },
    });
    for (const b of q.bindings) {
      bindings.push({
        source: b.exchange,
        destination: queueName(q.name),
        destination_type: 'queue',
        routing_key: b.pattern,
        arguments: {},
      });
    }
    for (const delay of RETRY_DELAYS) {
      queues.push({
        name: retryQueueName(q.name, delay),
        durable: true,
        auto_delete: false,
        arguments: {
          'x-queue-type': 'quorum',
          'x-message-ttl': RETRY_DELAY_MS[delay],
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': queueName(q.name),
        },
      });
      bindings.push({
        source: EXCHANGES.retry,
        destination: retryQueueName(q.name, delay),
        destination_type: 'queue',
        routing_key: retryQueueName(q.name, delay),
        arguments: {},
      });
    }
    queues.push({
      name: dlqName(q.name),
      durable: true,
      auto_delete: false,
      arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': -1 },
    });
    bindings.push({
      source: EXCHANGES.dlx,
      destination: dlqName(q.name),
      destination_type: 'queue',
      routing_key: q.name,
      arguments: {},
    });
  }
  return { rabbit_version: '4.1.0', exchanges, queues, bindings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(here, 'definitions.json'), `${JSON.stringify(buildDefinitions(), null, 2)}\n`);
  console.log('wrote infra/rabbitmq/definitions.json');
}
