import { describe, expect, it } from 'vitest';
import { ApiError } from '@cip/api-client';
import { nextPollDelay, pollDelays, shouldKeepPolling } from '@/lib/backoff';
import { readConsent, writeConsent } from '@/lib/consent';
import { shippingPrice } from '@/lib/shipping';
import { errorCode, errorMessage, stockIssues } from '@/lib/problem';
import { normalizeCard, validateAddress, EMPTY_FORM } from '@/lib/checkout-form';

describe('order polling backoff', () => {
  it('starts at 1s, grows by 1.5x and caps at 5s', () => {
    expect(nextPollDelay(null)).toBe(1000);
    expect(nextPollDelay(1000)).toBe(1500);
    expect(nextPollDelay(1500)).toBe(2250);
    expect(nextPollDelay(4000)).toBe(5000);
    expect(nextPollDelay(5000)).toBe(5000);
  });

  it('stops when the status changes or after a minute', () => {
    expect(shouldKeepPolling('pending_payment', 1000)).toBe(true);
    expect(shouldKeepPolling('paid', 1000)).toBe(false);
    expect(shouldKeepPolling('pending_payment', 61000)).toBe(false);
    const delays = pollDelays();
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60000);
    expect(Math.max(...delays)).toBe(5000);
  });
});

describe('consent storage', () => {
  it('reads only known values', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(readConsent(storage)).toBeNull();
    writeConsent(storage, 'granted');
    expect(readConsent(storage)).toBe('granted');
    map.set('cip_consent', 'maybe');
    expect(readConsent(storage)).toBeNull();
  });
});

describe('shipping price', () => {
  it('is free above the threshold', () => {
    const standard = { id: 'standard', label: 'Standard', cents: 500, freeOverCents: 10000 };
    expect(shippingPrice(standard, 9999)).toBe(500);
    expect(shippingPrice(standard, 10000)).toBe(0);
    expect(shippingPrice({ ...standard, freeOverCents: null }, 50000)).toBe(500);
  });
});

describe('problem helpers', () => {
  it('extracts stock issues from INSUFFICIENT_STOCK problems', () => {
    const error = new ApiError(409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      detail: 'Not enough stock',
      errors: [{ variantId: 'v1', requested: 3, available: 1 }],
    });
    expect(errorCode(error)).toBe('INSUFFICIENT_STOCK');
    expect(errorMessage(error)).toBe('Not enough stock');
    expect(stockIssues(error)).toEqual([{ variantId: 'v1', requested: 3, available: 1 }]);
    expect(stockIssues(new Error('x'))).toEqual([]);
  });
});

describe('checkout form', () => {
  it('validates the address step', () => {
    expect(Object.keys(validateAddress(EMPTY_FORM)).sort()).toEqual([
      'city',
      'email',
      'line1',
      'name',
      'postalCode',
    ]);
    expect(
      validateAddress({
        ...EMPTY_FORM,
        email: 'a@b.co',
        name: 'A',
        line1: 'x',
        city: 'c',
        postalCode: '1',
        country: 'DE',
      }),
    ).toEqual({});
  });

  it('normalises card numbers', () => {
    expect(normalizeCard('4242 4242-4242 4242')).toBe('4242424242424242');
  });
});
