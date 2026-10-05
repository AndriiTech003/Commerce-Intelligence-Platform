const hex: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

let lastMs = 0;
let lastSeq = 0;

export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = now;
  if (ms <= lastMs) {
    ms = lastMs;
    lastSeq = (lastSeq + 1) & 0xfff;
    if (lastSeq === 0) ms = ++lastMs;
  } else {
    lastSeq = ((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0);
    lastSeq &= 0x7ff;
  }
  lastMs = ms;
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = (ms >>> 24) & 0xff;
  bytes[3] = (ms >>> 16) & 0xff;
  bytes[4] = (ms >>> 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = 0x70 | ((lastSeq >>> 8) & 0x0f);
  bytes[7] = lastSeq & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += hex[bytes[i] ?? 0];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

export function uuidv7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

export const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
