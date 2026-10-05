import type { KeyValueStorage } from './checkout-session';

export const CONSENT_KEY = 'cip_consent';
export type ConsentChoice = 'granted' | 'denied';

export function readConsent(storage: Pick<KeyValueStorage, 'getItem'> | null): ConsentChoice | null {
  try {
    const value = storage?.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function writeConsent(storage: Pick<KeyValueStorage, 'setItem'> | null, choice: ConsentChoice): void {
  try {
    storage?.setItem(CONSENT_KEY, choice);
  } catch {
    return;
  }
}
