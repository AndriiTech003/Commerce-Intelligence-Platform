import { uuidv7 as trackerUuidv7 } from '@ashamrai/cip-tracker';

function secureRandom(): number {
  const bytes = new Uint8Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return (bytes[0] ?? 0) / 256;
}

export function newIdempotencyKey(now: number = Date.now()): string {
  return trackerUuidv7(now, secureRandom);
}
