import { z } from 'zod';

export interface CursorValue {
  v: string | number;
  id: string;
}

function toBase64(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64url');
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'base64url').toString('utf8');
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(normalized)));
}

export function encodeCursor(value: CursorValue): string {
  return toBase64(JSON.stringify(value));
}

export function decodeCursor(cursor: string | undefined | null): CursorValue | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(fromBase64(cursor)) as unknown;
    const result = z.object({ v: z.union([z.string(), z.number()]), id: z.string() }).safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export const cursorQuery = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
};

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}
