import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_KEY,
  clearCheckoutSession,
  getOrCreateCheckoutKey,
  isValidIdempotencyKey,
  loadPendingOrder,
  rotateCheckoutKey,
  savePendingOrder,
  type KeyValueStorage,
} from '@/lib/checkout-session';

class FakeStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const generator = () => {
  let n = 0;
  return () => `key-${String(++n).padStart(8, '0')}`;
};

describe('checkout idempotency key', () => {
  it('generates once and reuses the key for retries and reloads', () => {
    const storage = new FakeStorage();
    const next = generator();
    const first = getOrCreateCheckoutKey(storage, next);
    expect(getOrCreateCheckoutKey(storage, next)).toBe(first);
    expect(getOrCreateCheckoutKey(storage, next)).toBe(first);
    expect(storage.getItem(CHECKOUT_KEY)).toBe(first);
  });

  it('creates a new key after rotation or clearing', () => {
    const storage = new FakeStorage();
    const next = generator();
    const first = getOrCreateCheckoutKey(storage, next);
    rotateCheckoutKey(storage);
    const second = getOrCreateCheckoutKey(storage, next);
    expect(second).not.toBe(first);
    clearCheckoutSession(storage);
    expect(getOrCreateCheckoutKey(storage, next)).not.toBe(second);
  });

  it('replaces invalid stored keys', () => {
    const storage = new FakeStorage();
    storage.setItem(CHECKOUT_KEY, 'short');
    expect(getOrCreateCheckoutKey(storage, generator())).toBe('key-00000001');
    expect(isValidIdempotencyKey('has space in it')).toBe(false);
    expect(isValidIdempotencyKey('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
  });

  it('works without storage and survives throwing storage', () => {
    expect(getOrCreateCheckoutKey(null, generator())).toBe('key-00000001');
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(getOrCreateCheckoutKey(broken, generator())).toBe('key-00000001');
    expect(() => clearCheckoutSession(broken)).not.toThrow();
  });

  it('remembers a created order so a retry only confirms the payment', () => {
    const storage = new FakeStorage();
    expect(loadPendingOrder(storage)).toBeNull();
    savePendingOrder(storage, { orderId: 'o1', intentId: 'pi_1', provider: 'fake' });
    expect(loadPendingOrder(storage)).toEqual({ orderId: 'o1', intentId: 'pi_1', provider: 'fake' });
    clearCheckoutSession(storage);
    expect(loadPendingOrder(storage)).toBeNull();
    storage.setItem('cip_checkout_order', '{not json');
    expect(loadPendingOrder(storage)).toBeNull();
  });
});

describe('newIdempotencyKey', () => {
  it('produces valid unique uuidv7 keys', async () => {
    const { newIdempotencyKey } = await import('@/lib/ids');
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isValidIdempotencyKey(a)).toBe(true);
  });
});
