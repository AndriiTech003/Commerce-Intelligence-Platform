import { randomBytes } from 'node:crypto';
import type { Permission } from '@cip/contracts';

export type ApiKeyKind = 'publishable' | 'secret';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function base62(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte < 248) out += ALPHABET[byte % 62];
  }
  return out.length === length ? out : out + base62(length - out.length);
}

export function keyPrefixFor(kind: ApiKeyKind): string {
  return kind === 'publishable' ? 'pk_live_' : 'sk_live_';
}

export function generateApiKey(kind: ApiKeyKind): { raw: string; prefix: string } {
  const raw = `${keyPrefixFor(kind)}${base62(32)}`;
  return { raw, prefix: raw.slice(0, 12) };
}

export function kindOfKey(raw: string): ApiKeyKind | null {
  if (/^pk_live_[0-9A-Za-z]{16,64}$/.test(raw)) return 'publishable';
  if (/^sk_live_[0-9A-Za-z]{16,64}$/.test(raw)) return 'secret';
  return null;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  kind: ApiKeyKind;
  prefix: string;
  scopes: Permission[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}
