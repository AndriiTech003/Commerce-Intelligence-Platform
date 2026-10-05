import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function auth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

async function call(base, headers, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response;
}

export function loadDefinitions() {
  return JSON.parse(readFileSync(join(here, 'definitions.json'), 'utf8'));
}

export async function applyTopology({
  managementUrl = 'http://127.0.0.1:15672',
  user = 'guest',
  pass = 'guest',
  vhost = 'cip',
} = {}) {
  const headers = { authorization: auth(user, pass) };
  const v = encodeURIComponent(vhost);
  await call(managementUrl, headers, 'PUT', `/api/vhosts/${v}`, { default_queue_type: 'quorum' });
  await call(managementUrl, headers, 'PUT', `/api/permissions/${v}/${encodeURIComponent(user)}`, {
    configure: '.*',
    write: '.*',
    read: '.*',
  });
  await call(managementUrl, headers, 'POST', `/api/definitions/${v}`, loadDefinitions());
  return vhost;
}

export async function deleteVhost({
  managementUrl = 'http://127.0.0.1:15672',
  user = 'guest',
  pass = 'guest',
  vhost,
}) {
  if (!vhost || vhost === '/') throw new Error('refusing to delete this vhost');
  await call(
    managementUrl,
    { authorization: auth(user, pass) },
    'DELETE',
    `/api/vhosts/${encodeURIComponent(vhost)}`,
  );
}

export function amqpUrlFor(vhost, base = 'amqp://guest:guest@127.0.0.1:5672') {
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(vhost)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const vhost = process.argv[2] ?? process.env.RABBITMQ_VHOST ?? 'cip';
  await applyTopology({
    managementUrl: process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672',
    user: process.env.RABBITMQ_USER ?? 'guest',
    pass: process.env.RABBITMQ_PASS ?? 'guest',
    vhost,
  });
  console.log(`applied topology to vhost ${vhost}`);
}
