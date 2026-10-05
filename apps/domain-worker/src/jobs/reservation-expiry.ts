import type { Pool, PoolClient } from 'pg';
import { uuidv7 } from '@cip/contracts';
import { counter, type Logger } from '@cip/observability';

export interface ExpiredOrder {
  orderId: string;
  tenantId: string;
}

const expired = counter('reservations_expired_orders_total', 'Orders cancelled because reservations expired');

export async function findExpiredOrders(pool: Pool, limit = 100): Promise<ExpiredOrder[]> {
  const { rows } = await pool.query<{ order_id: string; tenant_id: string }>(
    `select distinct r.order_id, r.tenant_id
       from inventory_reservations r join orders o on o.id = r.order_id
      where r.status = 'active' and r.expires_at < now() and o.status = 'pending_payment'
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({ orderId: r.order_id, tenantId: r.tenant_id }));
}

async function cancelOne(client: PoolClient, order: ExpiredOrder): Promise<boolean> {
  await client.query('BEGIN');
  try {
    await client.query("select set_config('app.tenant_id', $1, true)", [order.tenantId]);
    const { rows } = await client.query<{ status: string; discount_code: string | null }>(
      'select status, discount_code from orders where id = $1 for update',
      [order.orderId],
    );
    const current = rows[0];
    if (!current || current.status !== 'pending_payment') {
      await client.query('ROLLBACK');
      return false;
    }
    const reservations = await client.query<{ variant_id: string; quantity: number }>(
      `select variant_id, sum(quantity)::int as quantity from inventory_reservations
        where order_id = $1 and status = 'active' group by variant_id order by variant_id`,
      [order.orderId],
    );
    for (const r of reservations.rows) {
      await client.query(
        'update inventory_items set reserved = greatest(reserved - $2, 0) where variant_id = $1',
        [r.variant_id, r.quantity],
      );
    }
    await client.query(
      "update inventory_reservations set status = 'released' where order_id = $1 and status = 'active'",
      [order.orderId],
    );
    await client.query("update orders set status = 'cancelled' where id = $1", [order.orderId]);
    await client.query(
      `insert into order_status_history (id, tenant_id, order_id, from_status, to_status, reason)
       values ($1, $2, $3, 'pending_payment', 'cancelled', 'payment_timeout')`,
      [uuidv7(), order.tenantId, order.orderId],
    );
    if (current.discount_code) {
      await client.query(
        'update discounts set used_count = greatest(used_count - 1, 0) where tenant_id = $1 and code = $2::citext',
        [order.tenantId, current.discount_code],
      );
    }
    await client.query(
      "update payments set status = 'failed' where order_id = $1 and status in ('requires_action', 'processing')",
      [order.orderId],
    );
    await client.query(
      `insert into outbox (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, headers)
       values ($1, $2, 'order', $3, 'order.cancelled', $4, '{"schema_version":1}')`,
      [
        uuidv7(),
        order.tenantId,
        order.orderId,
        JSON.stringify({ order_id: order.orderId, reason: 'payment_timeout' }),
      ],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function expireReservations(pool: Pool, logger?: Logger): Promise<number> {
  const orders = await findExpiredOrders(pool);
  let cancelled = 0;
  for (const order of orders) {
    const client = await pool.connect();
    try {
      if (await cancelOne(client, order)) cancelled += 1;
    } catch (error) {
      logger?.error({ err: error, orderId: order.orderId }, 'failed to expire reservation');
    } finally {
      client.release();
    }
  }
  if (cancelled > 0) {
    expired.inc(cancelled);
    logger?.info({ cancelled }, 'expired reservations released');
  }
  return cancelled;
}
