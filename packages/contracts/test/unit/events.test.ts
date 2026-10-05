import { describe, expect, it } from 'vitest';
import {
  normalizeOccurredAt,
  parseDomainEvent,
  parseTrackEvent,
  uuidv7,
  uuidv7Timestamp,
  uuidRegex,
  encodeCursor,
  decodeCursor,
  permissionsFor,
  hasPermission,
  QUEUES,
  dlqName,
  logicalNameFromDlq,
  shippingCost,
} from '../../src';

const tenant = '0190a000-0000-7000-8000-000000000001';

function trackFixture(overrides: Record<string, unknown> = {}) {
  return {
    event_id: uuidv7(),
    event_type: 'product_viewed',
    schema_version: 1,
    tenant_id: tenant,
    occurred_at: new Date().toISOString(),
    anonymous_id: uuidv7(),
    properties: { product_id: uuidv7(), category_path: 'running.shoes', price_cents: 12000 },
    ...overrides,
  };
}

describe('uuidv7', () => {
  it('produces sortable, valid ids', () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7());
    expect(ids.every((id) => uuidRegex.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]![14]).toBe('7');
  });

  it('encodes the timestamp', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(uuidv7Timestamp(uuidv7(now + 10_000_000))).toBeGreaterThanOrEqual(now);
  });
});

describe('track events (contract fixtures v1)', () => {
  it('accepts a valid product_viewed', () => {
    expect(parseTrackEvent(trackFixture()).ok).toBe(true);
  });

  it('rejects unknown types, versions and bad properties', () => {
    expect(parseTrackEvent(trackFixture({ event_type: 'nope' }))).toEqual({
      ok: false,
      reason: 'unknown event_type',
    });
    expect(parseTrackEvent(trackFixture({ schema_version: 3 })).ok).toBe(false);
    const bad = parseTrackEvent(trackFixture({ properties: { product_id: 'x' } }));
    expect(bad.ok).toBe(false);
  });

  it('keeps extra properties additive', () => {
    const parsed = parseTrackEvent(
      trackFixture({
        properties: { product_id: uuidv7(), category_path: 'a', price_cents: 1, extra: 'yes' },
      }),
    );
    expect(parsed.ok && (parsed.event.properties as Record<string, unknown>).extra).toBe('yes');
  });
});

describe('domain events', () => {
  it('validates order.paid', () => {
    const ok = parseDomainEvent({
      event_id: uuidv7(),
      event_type: 'order.paid',
      schema_version: 1,
      tenant_id: tenant,
      occurred_at: new Date().toISOString(),
      properties: { order_id: uuidv7(), amount_cents: 100 },
    });
    expect(ok.ok).toBe(true);
  });
});

describe('clock skew', () => {
  it('replaces occurred_at when skew exceeds 24h', () => {
    const received = '2026-01-02T00:00:00.000Z';
    expect(normalizeOccurredAt('2025-12-30T00:00:00.000Z', received)).toEqual({
      occurred_at: received,
      clock_skew: true,
    });
    expect(normalizeOccurredAt('2026-01-01T23:00:00.000Z', received).clock_skew).toBe(false);
  });
});

describe('helpers', () => {
  it('round-trips cursors and rejects garbage', () => {
    const c = encodeCursor({ v: '2026-01-01', id: 'abc' });
    expect(decodeCursor(c)).toEqual({ v: '2026-01-01', id: 'abc' });
    expect(decodeCursor('%%%')).toBeNull();
  });

  it('maps roles to permissions', () => {
    expect(hasPermission(permissionsFor('catalog_manager'), 'catalog:write')).toBe(true);
    expect(hasPermission(permissionsFor('catalog_manager'), 'orders:read')).toBe(false);
    expect(hasPermission(permissionsFor('support'), 'orders:manage')).toBe(true);
  });

  it('names topology consistently', () => {
    expect(QUEUES.map((q) => logicalNameFromDlq(dlqName(q.name)))).toEqual(QUEUES.map((q) => q.name));
    expect(logicalNameFromDlq('q.unknown.dlq')).toBeNull();
  });

  it('computes shipping', () => {
    expect(shippingCost('standard', 5000)).toBe(500);
    expect(shippingCost('standard', 10000)).toBe(0);
    expect(shippingCost('express', 100000)).toBe(1500);
  });
});
