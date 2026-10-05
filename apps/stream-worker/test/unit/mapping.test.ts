import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cip/contracts';
import { PoisonMessageError } from '@cip/messaging';
import {
  chDateTime,
  derivedId,
  domainRows,
  feedLabel,
  flag,
  parsePipelineEvent,
  trackRows,
} from '../../src/mapping';

const tenant = uuidv7();

describe('event mapping (contract fixtures)', () => {
  const view = {
    event_id: uuidv7(),
    event_type: 'product_viewed',
    schema_version: 1,
    tenant_id: tenant,
    occurred_at: '2026-01-02T03:04:05.678Z',
    received_at: '2026-01-02T03:04:06.000Z',
    anonymous_id: uuidv7(),
    context: { country: 'DE', device: 'mobile' as const },
    properties: {
      product_id: uuidv7(),
      category_path: 'running.shoes',
      price_cents: 12000,
      title: 'Trail Runner X',
    },
  };

  it('accepts supported versions of track and domain events and rejects others as poison', () => {
    expect(parsePipelineEvent(view).kind).toBe('track');
    expect(() => parsePipelineEvent({ ...view, schema_version: 9 })).toThrow(PoisonMessageError);
    expect(() => parsePipelineEvent({ event_type: 'order.paid' })).toThrow(PoisonMessageError);
  });

  it('maps track events to one ClickHouse row', () => {
    const parsed = parsePipelineEvent(view);
    if (parsed.kind !== 'track') throw new Error('unexpected');
    const [row] = trackRows(parsed.event);
    expect(row).toMatchObject({
      event_id: view.event_id,
      tenant_id: tenant,
      profile_id: view.anonymous_id,
      product_id: view.properties.product_id,
      category_path: 'running.shoes',
      price_cents: 12000,
      country: 'DE',
      device: 'mobile',
      occurred_at: '2026-01-02 03:04:05.678',
    });
    expect(feedLabel(parsed)).toBe(`Someone from ${flag('DE')} DE viewed Trail Runner X`);
  });

  it('explodes order.placed into an order row plus deterministic item rows', () => {
    const placed = parsePipelineEvent({
      event_id: uuidv7(),
      event_type: 'order.placed',
      schema_version: 1,
      tenant_id: tenant,
      occurred_at: new Date().toISOString(),
      properties: {
        order_id: uuidv7(),
        number: 7,
        profile_id: uuidv7(),
        items: [
          { product_id: uuidv7(), variant_id: uuidv7(), qty: 3, unit_price_cents: 100, category_path: 'a' },
        ],
        total_cents: 300,
        currency: 'USD',
      },
    });
    if (placed.kind !== 'domain') throw new Error('unexpected');
    const rows = domainRows(placed.event);
    expect(rows.map((r) => r.event_type)).toEqual(['order_placed', 'purchase_item']);
    expect(rows[1]).toMatchObject({ quantity: 3, revenue_cents: 300 });
    expect(domainRows(placed.event)[1]!.event_id).toBe(rows[1]!.event_id);
    expect(rows[0]!.revenue_cents).toBeNull();
  });

  it('records refunds as negative revenue', () => {
    const refunded = parsePipelineEvent({
      event_id: uuidv7(),
      event_type: 'order.refunded',
      schema_version: 1,
      tenant_id: tenant,
      occurred_at: new Date().toISOString(),
      properties: { order_id: uuidv7(), amount_cents: 500 },
    });
    if (refunded.kind !== 'domain') throw new Error('unexpected');
    expect(domainRows(refunded.event)[0]!.revenue_cents).toBe(-500);
  });

  it('derives valid UUIDs and ClickHouse timestamps', () => {
    expect(derivedId('a', 'b')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(chDateTime('2026-01-01T00:00:00Z')).toBe('2026-01-01 00:00:00.000');
  });
});
