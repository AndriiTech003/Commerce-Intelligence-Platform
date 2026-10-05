import { describe, expect, it } from 'vitest';
import {
  cohortMatrix,
  deltaPct,
  funnelSteps,
  previousPeriod,
  resolvePeriod,
} from '../../src/modules/analytics/domain/analytics';
import { entityIdFrom } from '../../src/modules/audit/domain/audit';
import { mergeQuantities, priceLines, type CartLine } from '../../src/modules/cart/domain/cart';
import {
  assertUniqueSkus,
  childPath,
  depthOf,
  etagOf,
  parseIfMatch,
  priceMin,
  slugify,
} from '../../src/modules/catalog/domain/catalog';
import { generateDemoCatalog } from '../../src/modules/catalog/domain/demo-catalog';
import { computeTotals } from '../../src/modules/checkout/domain/checkout';
import { evaluateDiscount, type Discount } from '../../src/modules/discounts/domain/discount';
import {
  decideRefresh,
  invitationToken,
  parseInvitationToken,
} from '../../src/modules/identity/domain/identity';
import { crossedLowStock, lockOrder } from '../../src/modules/inventory/domain/inventory';
import {
  fakeCardOutcome,
  luhnValid,
  signatureHeader,
  verifySignatureHeader,
} from '../../src/modules/payments/domain/payment';
import { storeSlugFromHost } from '../../src/modules/tenancy/domain/tenant';
import { stableStringify } from '../../src/shared/crypto';
import { diffObjects } from '../../src/shared/diff';

const discount = (overrides: Partial<Discount> = {}): Discount => ({
  id: 'd',
  code: 'X',
  type: 'percent',
  value: 10,
  minSubtotalCents: 0,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  usedCount: 0,
  active: true,
  ...overrides,
});

describe('discounts', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('computes percent and fixed amounts, capped at the subtotal', () => {
    expect(evaluateDiscount(discount(), { subtotalCents: 9999, now, customerUses: 0 })).toEqual({
      ok: true,
      amountCents: 999,
    });
    expect(
      evaluateDiscount(discount({ type: 'fixed', value: 5000 }), {
        subtotalCents: 3000,
        now,
        customerUses: 0,
      }),
    ).toEqual({ ok: true, amountCents: 3000 });
  });
  it('checks dates, limits, minimum and activity', () => {
    const check = (d: Partial<Discount>, subtotal = 1000, uses = 0) =>
      evaluateDiscount(discount(d), { subtotalCents: subtotal, now, customerUses: uses }).ok;
    expect(check({ active: false })).toBe(false);
    expect(check({ startsAt: new Date('2026-07-01') })).toBe(false);
    expect(check({ endsAt: new Date('2026-05-01') })).toBe(false);
    expect(check({ usageLimit: 2, usedCount: 2 })).toBe(false);
    expect(check({ perCustomerLimit: 1 }, 1000, 1)).toBe(false);
    expect(check({ minSubtotalCents: 2000 })).toBe(false);
    expect(check({ minSubtotalCents: 1000 })).toBe(true);
  });
});

describe('cart pricing', () => {
  const line = (overrides: Partial<CartLine> = {}): CartLine => ({
    variantId: 'v',
    productId: 'p',
    productTitle: 'P',
    productSlug: 'p',
    productStatus: 'active',
    variantTitle: 'V',
    sku: 'S',
    imageKey: null,
    categoryPath: null,
    quantity: 2,
    unitPriceCents: 1500,
    addedPriceCents: 1500,
    onHand: 10,
    reserved: 3,
    currency: 'USD',
    ...overrides,
  });
  it('recalculates prices, flags price changes and drops inactive products', () => {
    const priced = priceLines([
      line(),
      line({ variantId: 'w', addedPriceCents: 1000 }),
      line({ variantId: 'z', productStatus: 'archived' }),
    ]);
    expect(priced.subtotalCents).toBe(6000);
    expect(priced.itemsCount).toBe(4);
    expect(priced.lines[1]).toMatchObject({ priceChanged: true, previousUnitPriceCents: 1000, available: 7 });
    expect(priced.lines).toHaveLength(2);
  });
  it('caps merged quantities at 99', () => {
    expect(mergeQuantities(60, 50)).toBe(99);
  });
  it('computes totals with free shipping over the threshold', () => {
    expect(computeTotals({ subtotalCents: 12000, discountCents: 3000, shippingMethod: 'standard' })).toEqual({
      subtotalCents: 12000,
      discountCents: 3000,
      shippingCents: 500,
      totalCents: 9500,
    });
    expect(
      computeTotals({ subtotalCents: 12000, discountCents: 0, shippingMethod: 'standard' }).shippingCents,
    ).toBe(0);
  });
});

describe('inventory', () => {
  it('locks variants in a deterministic order and merges duplicates', () => {
    expect(
      lockOrder([
        { variantId: 'b', quantity: 1 },
        { variantId: 'a', quantity: 2 },
        { variantId: 'b', quantity: 3 },
      ]),
    ).toEqual([
      { variantId: 'a', quantity: 2 },
      { variantId: 'b', quantity: 4 },
    ]);
  });
  it('detects crossing the low stock threshold once', () => {
    expect(crossedLowStock(6, 5, 5)).toBe(true);
    expect(crossedLowStock(5, 4, 5)).toBe(false);
  });
});

describe('catalog', () => {
  it('slugifies and builds ltree paths', () => {
    expect(slugify('Trail Runner X — Ülta!')).toBe('trail-runner-x-ulta');
    expect(childPath('running.shoes', 'trail-shoes')).toBe('running.shoes.trail_shoes');
    expect(depthOf('a.b.c')).toBe(3);
    expect(priceMin([{ priceCents: 3 }, { priceCents: 1 }])).toBe(1);
  });
  it('parses If-Match values', () => {
    expect(parseIfMatch(etagOf('123'))).toBe('123');
    expect(parseIfMatch('W/"9"')).toBe('9');
    expect(parseIfMatch(undefined)).toBeNull();
  });
  it('rejects duplicate skus', () => {
    expect(() => assertUniqueSkus([{ sku: 'A' }, { sku: 'a' }])).toThrow();
  });
  it('generates stable demo catalogs', () => {
    const a = generateDemoCatalog('runhub', 300, 1, 'RH');
    const b = generateDemoCatalog('runhub', 300, 1, 'RH');
    expect(a.products).toHaveLength(300);
    expect(a).toEqual(b);
    expect(new Set(a.products.map((p) => p.slug)).size).toBe(300);
    expect(new Set(a.products.flatMap((p) => p.variants.map((v) => v.sku))).size).toBe(
      a.products.reduce((s, p) => s + p.variants.length, 0),
    );
    expect(generateDemoCatalog('homebrew', 150, 2, 'HB').products).toHaveLength(150);
  });
});

describe('identity', () => {
  const base = {
    id: '1',
    subjectId: 's',
    subjectType: 'user' as const,
    tenantId: null,
    familyId: 'f',
    revokedAt: null,
    replacedBy: null,
  };
  it('decides refresh rotation, reuse and expiry', () => {
    const now = new Date('2026-01-01');
    expect(decideRefresh({ ...base, expiresAt: new Date('2026-02-01') }, now)).toEqual({ kind: 'rotate' });
    expect(decideRefresh({ ...base, expiresAt: new Date('2026-02-01'), replacedBy: 'x' }, now)).toEqual({
      kind: 'reuse',
    });
    expect(decideRefresh({ ...base, expiresAt: new Date('2025-12-01') }, now)).toEqual({ kind: 'expired' });
  });
  it('round-trips invitation tokens', () => {
    const tenant = '0190a000-0000-7000-8000-000000000001';
    expect(parseInvitationToken(invitationToken(tenant, 'abcdefghijklmnopqrstuvwxyz'))).toEqual({
      tenantId: tenant,
      secret: 'abcdefghijklmnopqrstuvwxyz',
    });
    expect(parseInvitationToken('nope')).toBeNull();
  });
});

describe('payments', () => {
  it('verifies webhook signatures with timestamp tolerance', () => {
    const header = signatureHeader('secret', '{"a":1}', 1000);
    expect(() => verifySignatureHeader(header, 'secret', '{"a":1}', 1000)).not.toThrow();
    expect(() => verifySignatureHeader(header, 'other', '{"a":1}', 1000)).toThrow();
    expect(() => verifySignatureHeader(header, 'secret', '{"a":2}', 1000)).toThrow();
    expect(() => verifySignatureHeader(header, 'secret', '{"a":1}', 2000)).toThrow();
    expect(() => verifySignatureHeader(undefined, 'secret', '{}', 1000)).toThrow();
  });
  it('classifies fake cards', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true);
    expect(fakeCardOutcome('4242424242424242')).toBe('succeeded');
    expect(fakeCardOutcome('4000000000000002')).toBe('failed');
    expect(() => fakeCardOutcome('1234567812345678')).toThrow();
  });
});

describe('shared helpers', () => {
  it('diffs objects field by field', () => {
    expect(diffObjects({ a: 1, b: 2, updatedAt: 1 }, { a: 1, b: 3, c: 4, updatedAt: 2 })).toEqual({
      b: [2, 3],
      c: [null, 4],
    });
  });
  it('stringifies deterministically', () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
  it('resolves stores from hosts and audit ids from params', () => {
    expect(storeSlugFromHost('runhub.localhost:4130')).toBe('runhub');
    expect(storeSlugFromHost('localhost:4130')).toBeNull();
    expect(storeSlugFromHost('127.0.0.1')).toBeNull();
    expect(entityIdFrom({ id: '0190a000-0000-7000-8000-000000000001' }, null)).toBe(
      '0190a000-0000-7000-8000-000000000001',
    );
  });
  it('computes analytics helpers', () => {
    expect(
      funnelSteps(
        [
          { level: 1, users: 5 },
          { level: 2, users: 3 },
          { level: 4, users: 2 },
        ],
        ['a', 'b', 'c', 'd'],
      ).map((s) => s.users),
    ).toEqual([10, 5, 2, 2]);
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(1, 0)).toBeNull();
    const period = resolvePeriod('2026-01-10T00:00:00Z', '2026-01-20T00:00:00Z');
    expect(previousPeriod(period).from.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    expect(
      cohortMatrix(
        [
          { cohort: '2026-01-05', week: 0, users: 4 },
          { cohort: '2026-01-05', week: 1, users: 1 },
        ],
        3,
      ),
    ).toEqual([{ cohort: '2026-01-05', size: 4, retention: [100, 25, 0] }]);
  });
});
