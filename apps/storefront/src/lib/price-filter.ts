export interface PriceFilter {
  minCents: number | null;
  maxCents: number | null;
}

const AMOUNT = /^\d+(\.\d{1,2})?$/;

function toCents(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!AMOUNT.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export function parsePriceFilter(raw: string | null | undefined): PriceFilter {
  if (!raw) return { minCents: null, maxCents: null };
  const parts = raw.split('-');
  if (parts.length !== 2) return { minCents: null, maxCents: null };
  let minCents = toCents(parts[0]);
  let maxCents = toCents(parts[1]);
  if (minCents !== null && maxCents !== null && minCents > maxCents)
    [minCents, maxCents] = [maxCents, minCents];
  return { minCents, maxCents };
}

function toMajor(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function formatPriceFilter(filter: PriceFilter): string | null {
  if (filter.minCents === null && filter.maxCents === null) return null;
  const min = filter.minCents === null ? '' : toMajor(filter.minCents);
  const max = filter.maxCents === null ? '' : toMajor(filter.maxCents);
  return `${min}-${max}`;
}

export function priceFilterFromInputs(min: string, max: string): string | null {
  return formatPriceFilter({ minCents: toCents(min), maxCents: toCents(max) });
}

export function centsToInput(cents: number | null): string {
  return cents === null ? '' : toMajor(cents);
}
