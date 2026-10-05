export const PERSONAS = [
  'marathon_runner',
  'weekend_hiker',
  'bargain_hunter',
  'gift_buyer',
  'window_shopper',
] as const;
export type Persona = (typeof PERSONAS)[number];

export const DEFAULT_SHARES: Record<Persona, number> = {
  marathon_runner: 0.3,
  weekend_hiker: 0.25,
  bargain_hunter: 0.2,
  gift_buyer: 0.1,
  window_shopper: 0.15,
};

export function normalizeShares<K extends string>(shares: Record<K, number>): Record<K, number> {
  const entries = Object.entries(shares) as Array<[K, number]>;
  const total = entries.reduce((sum, [, v]) => sum + (Number.isFinite(v) && v > 0 ? v : 0), 0);
  return Object.fromEntries(
    entries.map(([k, v]) => [k, total > 0 && Number.isFinite(v) && v > 0 ? v / total : 0]),
  ) as Record<K, number>;
}
