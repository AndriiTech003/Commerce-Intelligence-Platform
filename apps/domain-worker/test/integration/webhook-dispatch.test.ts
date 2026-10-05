import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@cip/contracts';
import { createLogger } from '@cip/observability';
import { WebhookDispatcher } from '../../src/webhooks';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://asnh@127.0.0.1:5432/postgres';
const dbName = `cip_test_wh_${randomBytes(4).toString('hex')}`;
const admin = new Pool({ connectionString: adminUrl, max: 1 });
let pool: Pool;

describe('webhook dispatcher', () => {
  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString(), max: 5 });
    await pool.query(`
      create table webhook_endpoints (
        id uuid primary key, tenant_id uuid not null, url text not null, secret text not null,
        status text not null default 'active', events text[] not null, disabled_at timestamptz
      );
      create table webhook_deliveries (
        id uuid primary key, tenant_id uuid not null, endpoint_id uuid not null references webhook_endpoints(id),
        event_id text not null, event_type text not null, payload jsonb not null,
        status text not null default 'pending', attempts int not null default 0,
        next_attempt_at timestamptz, last_status_code int, last_error text, duration_ms int,
        created_at timestamptz not null default now(), delivered_at timestamptz,
        unique (endpoint_id, event_id)
      );
    `);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it('never sends the same delivery twice when the poller runs during an inline delivery', async () => {
    const tenantId = randomUUID();
    await pool.query(
      `insert into webhook_endpoints (id, tenant_id, url, secret, events) values ($1, $2, 'http://receiver.test/hook', 'whsec_x', '{order.paid}')`,
      [randomUUID(), tenantId],
    );
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 300));
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const dispatcher = new WebhookDispatcher(
      pool,
      { send: async () => undefined },
      createLogger('test', { level: 'silent' }),
      { scheduleSeconds: [60, 300], timeoutMs: 5000, fetchImpl },
    );
    const event = {
      event_id: randomUUID(),
      event_type: 'order.paid',
      schema_version: 1,
      tenant_id: tenantId,
      occurred_at: new Date().toISOString(),
      properties: { order_id: randomUUID(), amount_cents: 1000 },
    } as unknown as DomainEvent;
    const inline = dispatcher.enqueue(event);
    await new Promise((r) => setTimeout(r, 50));
    const polled = await Promise.all([dispatcher.deliverDue(), dispatcher.deliverDue()]);
    await inline;
    expect(polled).toEqual([0, 0]);
    expect(calls).toBe(1);
    const { rows } = await pool.query<{ status: string; attempts: number }>(
      'select status, attempts from webhook_deliveries',
    );
    expect(rows).toEqual([{ status: 'succeeded', attempts: 1 }]);
  });

  it('picks up a delivery left pending by a crashed inline attempt once its lease expires', async () => {
    const tenantId = randomUUID();
    const endpointId = randomUUID();
    await pool.query(
      `insert into webhook_endpoints (id, tenant_id, url, secret, events) values ($1, $2, 'http://receiver.test/hook2', 'whsec_y', '{order.paid}')`,
      [endpointId, tenantId],
    );
    await pool.query(
      `insert into webhook_deliveries (id, tenant_id, endpoint_id, event_id, event_type, payload, status, next_attempt_at)
       values ($1, $2, $3, $4, 'order.paid', '{}'::jsonb, 'pending', now() - interval '1 second')`,
      [randomUUID(), tenantId, endpointId, randomUUID()],
    );
    let calls = 0;
    const dispatcher = new WebhookDispatcher(
      pool,
      { send: async () => undefined },
      createLogger('test', { level: 'silent' }),
      {
        scheduleSeconds: [60],
        timeoutMs: 5000,
        fetchImpl: (async () => {
          calls += 1;
          return new Response('ok', { status: 200 });
        }) as typeof fetch,
      },
    );
    expect(await dispatcher.deliverDue()).toBe(1);
    expect(calls).toBe(1);
  });
});
