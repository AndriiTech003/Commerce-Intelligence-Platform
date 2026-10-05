export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const CHECKOUT_KEY = 'cip_checkout_key';
export const CHECKOUT_ORDER = 'cip_checkout_order';

const PRINTABLE = /^[\x21-\x7e]{8,255}$/;

export interface PendingOrder {
  orderId: string;
  intentId: string;
  provider: string;
}

export function isValidIdempotencyKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && PRINTABLE.test(value);
}

export function getOrCreateCheckoutKey(storage: KeyValueStorage | null, generate: () => string): string {
  const existing = safeGet(storage, CHECKOUT_KEY);
  if (isValidIdempotencyKey(existing)) return existing;
  const key = generate();
  safeSet(storage, CHECKOUT_KEY, key);
  return key;
}

export function rotateCheckoutKey(storage: KeyValueStorage | null): void {
  safeRemove(storage, CHECKOUT_KEY);
}

export function savePendingOrder(storage: KeyValueStorage | null, order: PendingOrder): void {
  safeSet(storage, CHECKOUT_ORDER, JSON.stringify(order));
}

export function loadPendingOrder(storage: KeyValueStorage | null): PendingOrder | null {
  const raw = safeGet(storage, CHECKOUT_ORDER);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingOrder> | null;
    if (value && typeof value.orderId === 'string' && typeof value.intentId === 'string') {
      return { orderId: value.orderId, intentId: value.intentId, provider: String(value.provider ?? 'fake') };
    }
  } catch {
    return null;
  }
  return null;
}

export function clearCheckoutSession(storage: KeyValueStorage | null): void {
  safeRemove(storage, CHECKOUT_KEY);
  safeRemove(storage, CHECKOUT_ORDER);
}

function safeGet(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: KeyValueStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    return;
  }
}

function safeRemove(storage: KeyValueStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    return;
  }
}
