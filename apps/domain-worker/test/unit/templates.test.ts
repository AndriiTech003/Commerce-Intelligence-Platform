import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { PoisonMessageError } from '@cip/messaging';
import { parseNotification } from '../../src/notifications/handler';
import { lowStockMail, money, orderMail } from '../../src/notifications/templates';

const data = {
  number: 1042,
  email: 'b@x.dev',
  totalCents: 12345,
  currency: 'EUR',
  storeName: 'HomeBrew',
  storeUrl: 'http://homebrew.localhost:4130',
  orderId: 'o1',
  items: [{ title: 'Grinder', quantity: 1, unitPriceCents: 12345 }],
};

describe('notification templates', () => {
  it('renders order emails', () => {
    expect(orderMail('order.paid', data).subject).toBe('HomeBrew: payment received for order #1042');
    expect(orderMail('order.paid', data).text).toContain('http://homebrew.localhost:4130/orders/o1');
    expect(orderMail('order.cancelled', data, { reason: 'payment_timeout' }).text).toContain(
      'not completed in time',
    );
    expect(money(12345, 'EUR')).toBe('€123.45');
  });

  it('renders low stock emails', () => {
    expect(lowStockMail({ storeName: 'S', sku: 'A-1', title: 'T', available: 2, threshold: 3 }).subject).toBe(
      'S: low stock for A-1',
    );
  });

  it('treats invalid domain events as poison', () => {
    expect(() => parseNotification({ event_type: 'order.paid' })).toThrow(PoisonMessageError);
    expect(
      parseNotification({
        event_id: uuidv7(),
        event_type: 'order.fulfilled',
        schema_version: 1,
        tenant_id: uuidv7(),
        occurred_at: new Date().toISOString(),
        properties: { order_id: uuidv7() },
      }).event_type,
    ).toBe('order.fulfilled');
  });
});
