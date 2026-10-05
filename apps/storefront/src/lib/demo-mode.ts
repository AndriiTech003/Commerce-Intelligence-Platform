import type { KeyValueStorage } from './checkout-session';

export const DEMO_KEY = 'cip_demo';

export function demoParam(search: string): boolean | null {
  const value = new URLSearchParams(search).get('demo');
  if (value === '1' || value === 'true' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'off') return false;
  return null;
}

export function readDemo(storage: Pick<KeyValueStorage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDemo(
  storage: Pick<KeyValueStorage, 'setItem' | 'removeItem'> | null,
  enabled: boolean,
): void {
  try {
    if (enabled) storage?.setItem(DEMO_KEY, '1');
    else storage?.removeItem(DEMO_KEY);
  } catch {
    return;
  }
}
