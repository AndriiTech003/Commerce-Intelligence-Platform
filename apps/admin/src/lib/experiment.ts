import { betaDensityCurve, betaMean, betaVariance } from '@cip/personalization';

export const SERIES_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const;

export const OTHER_COLOR = '#94a3b8';

export function colorFor(index: number): string {
  return index >= 0 && index < SERIES_COLORS.length ? SERIES_COLORS[index]! : OTHER_COLOR;
}

export function parseBucket(t: string): number {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(t)) return Date.parse(`${t.replace(' ', 'T')}Z`);
  return Date.parse(t);
}

export interface TrafficPoint {
  t: string;
  segmentKey: string;
  creativeId: string;
  decisions: number;
}

export interface TrafficShare {
  times: number[];
  creativeIds: string[];
  shares: Record<string, number[]>;
  totals: number[];
}

export function trafficShare(points: TrafficPoint[], segmentKey: string | null): TrafficShare {
  const relevant = points.filter((p) => segmentKey === null || p.segmentKey === segmentKey);
  const times = [...new Set(relevant.map((p) => parseBucket(p.t)))]
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const creativeIds = [...new Set(relevant.map((p) => p.creativeId))].sort();
  const index = new Map(times.map((t, i) => [t, i]));
  const counts: Record<string, number[]> = Object.fromEntries(
    creativeIds.map((id) => [id, new Array<number>(times.length).fill(0)]),
  );
  for (const point of relevant) {
    const i = index.get(parseBucket(point.t));
    if (i === undefined) continue;
    counts[point.creativeId]![i]! += point.decisions;
  }
  const totals = times.map((_, i) => creativeIds.reduce((sum, id) => sum + counts[id]![i]!, 0));
  const shares: Record<string, number[]> = Object.fromEntries(
    creativeIds.map((id) => [
      id,
      counts[id]!.map((value, i) => (totals[i]! > 0 ? Math.round((value / totals[i]!) * 10000) / 100 : 0)),
    ]),
  );
  return { times, creativeIds, shares, totals };
}

export interface DensityArm {
  alpha: number;
  beta: number;
  high: number;
}

export function densityRange(arms: DensityArm[]): [number, number] {
  if (arms.length === 0) return [0, 1];
  const top = Math.max(
    ...arms.map((arm) => {
      const mean = betaMean(arm.alpha, arm.beta);
      const sd = Math.sqrt(betaVariance(arm.alpha, arm.beta));
      return Math.max(arm.high, mean + 3 * sd);
    }),
  );
  const upper = Math.min(1, Math.max(0.01, top * 1.5));
  return [0, Math.round(upper * 10000) / 10000];
}

export interface DensityCurve {
  points: Array<{ x: number; y: number }>;
  peak: number;
}

export function densityCurves(
  arms: Array<{ alpha: number; beta: number }>,
  range: [number, number],
  resolution = 160,
): DensityCurve[] {
  return arms.map((arm) => {
    const points = betaDensityCurve(arm.alpha, arm.beta, resolution, range).map((p) => ({
      x: p.x,
      y: Number.isFinite(p.y) ? p.y : 0,
    }));
    return { points, peak: Math.max(0, ...points.map((p) => p.y)) };
  });
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatInterval(rate: number, low: number, high: number): string {
  return `${pct(rate)} (${(low * 100).toFixed(1)}–${pct(high)})`;
}

export interface HistoryPoint {
  snapshotAt: string;
  segmentKey: string;
  creativeId: string;
  alpha: number;
  beta: number;
}

export function historySeries(
  history: HistoryPoint[],
  segmentKey: string | null,
): Array<{ creativeId: string; points: Array<[number, number]> }> {
  const grouped = new Map<string, Array<[number, number]>>();
  for (const h of history) {
    if (segmentKey !== null && h.segmentKey !== segmentKey) continue;
    const key = segmentKey === null ? `${h.segmentKey}:${h.creativeId}` : h.creativeId;
    const list = grouped.get(key) ?? [];
    list.push([Date.parse(h.snapshotAt), h.alpha / (h.alpha + h.beta)]);
    grouped.set(key, list);
  }
  return [...grouped.entries()]
    .map(([creativeId, points]) => ({ creativeId, points: points.sort((a, b) => a[0] - b[0]) }))
    .sort((a, b) => a.creativeId.localeCompare(b.creativeId));
}

export function lift(personalized: number, holdout: number): number | null {
  if (holdout <= 0) return null;
  return ((personalized - holdout) / holdout) * 100;
}

export function niceTicks(from: number, to: number, target = 5): number[] {
  const span = to - from;
  if (!(span > 0)) return [from];
  const raw = span / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw * 0.75) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(from / step) * step; v <= to + step * 1e-9; v += step)
    ticks.push(Number(v.toFixed(10)));
  return ticks;
}
