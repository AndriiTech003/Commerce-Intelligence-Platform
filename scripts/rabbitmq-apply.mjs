import { applyTopology } from '../infra/rabbitmq/apply.mjs';

const vhost = process.argv[2] ?? process.env.RABBITMQ_VHOST ?? 'cip';
await applyTopology({
  managementUrl: process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672',
  user: process.env.RABBITMQ_USER ?? 'guest',
  pass: process.env.RABBITMQ_PASS ?? 'guest',
  vhost,
});
console.log(`rabbitmq: topology applied to vhost ${vhost}`);
