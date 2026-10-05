export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
  baseMs = 500,
  maxMs = 15000,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + random() * (exp / 2));
}
