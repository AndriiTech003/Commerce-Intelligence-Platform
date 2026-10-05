import type { Pool, PoolClient } from 'pg';
import { parseDomainEvent, type DomainEvent } from '@cip/contracts';
import { PoisonMessageError } from '@cip/messaging';
import { counter, type Logger } from '@cip/observability';
import { lowStockMail, orderMail, type OrderMailData, type OrderMailKind } from './templates';

export interface MailTransport {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

const sent = counter('notifications_sent_total', 'Notification emails sent', ['type']);

export const NOTIFICATIONS_CONSUMER = 'notifications';

export function parseNotification(raw: unknown): DomainEvent {
  const parsed = parseDomainEvent(raw);
  if (!parsed.ok) throw new PoisonMessageError(parsed.reason);
  return parsed.event;
}

async function loadOrder(
  client: PoolClient,
  orderId: string,
  storeUrlTemplate: string,
): Promise<OrderMailData | null> {
  const { rows } = await client.query<{
    number: string;
    email: string;
    total_cents: string;
    currency: string;
    slug: string;
    name: string;
  }>(
    `select o.number, o.email, o.total_cents, o.currency, t.slug, t.name
       from orders o join tenants t on t.id = o.tenant_id where o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) return null;
  const items = await client.query<{ title_snapshot: string; quantity: number; unit_price_cents: string }>(
    'select title_snapshot, quantity, unit_price_cents from order_items where order_id = $1 order by id',
    [orderId],
  );
  return {
    number: Number(order.number),
    email: order.email,
    totalCents: Number(order.total_cents),
    currency: order.currency,
    storeName: order.name,
    storeUrl: storeUrlTemplate.replace('{store}', order.slug),
    orderId,
    items: items.rows.map((i) => ({
      title: i.title_snapshot,
      quantity: i.quantity,
      unitPriceCents: Number(i.unit_price_cents),
    })),
  };
}

export class NotificationHandler {
  constructor(
    private readonly pool: Pool,
    private readonly mail: MailTransport,
    private readonly storeUrlTemplate: string,
    private readonly logger?: Logger,
  ) {}

  async handle(event: DomainEvent, messageId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        'insert into processed_messages (consumer, message_id) values ($1, $2) on conflict do nothing returning message_id',
        [NOTIFICATIONS_CONSUMER, messageId],
      );
      if (claimed.rowCount === 0) {
        await client.query('COMMIT');
        return;
      }
      await this.dispatch(client, event);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async dispatch(client: PoolClient, event: DomainEvent): Promise<void> {
    switch (event.event_type) {
      case 'order.paid':
      case 'order.fulfilled':
      case 'order.refunded':
      case 'order.cancelled': {
        const data = await loadOrder(client, event.properties.order_id, this.storeUrlTemplate);
        if (!data) {
          this.logger?.warn({ orderId: event.properties.order_id }, 'order for notification not found');
          return;
        }
        const reason = event.event_type === 'order.cancelled' ? event.properties.reason : undefined;
        const mail = orderMail(event.event_type as OrderMailKind, data, reason ? { reason } : {});
        await this.mail.send({ to: data.email, ...mail });
        sent.inc({ type: event.event_type });
        return;
      }
      case 'inventory.low_stock': {
        const { rows } = await client.query<{ sku: string; title: string; name: string }>(
          `select v.sku, p.title, t.name from product_variants v join products p on p.id = v.product_id
             join tenants t on t.id = v.tenant_id where v.id = $1`,
          [event.properties.variant_id],
        );
        const variant = rows[0];
        if (!variant) return;
        const owners = await client.query<{ email: string }>(
          `select u.email from memberships m join users u on u.id = m.user_id
            where m.tenant_id = $1 and m.role in ('owner', 'admin')`,
          [event.tenant_id],
        );
        const mail = lowStockMail({
          storeName: variant.name,
          sku: variant.sku,
          title: variant.title,
          available: event.properties.available,
          threshold: event.properties.threshold,
        });
        for (const owner of owners.rows) await this.mail.send({ to: owner.email, ...mail });
        sent.inc({ type: event.event_type });
        return;
      }
      default:
        return;
    }
  }
}
