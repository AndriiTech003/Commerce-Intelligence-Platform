function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  ignore: string[] = ['updatedAt', 'updated_at', 'version', 'searchTsv'],
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const a = before ? before[key] : undefined;
    const b = after ? after[key] : undefined;
    if (!same(a, b)) out[key] = [normalize(a) ?? null, normalize(b) ?? null];
  }
  return out;
}
