export interface SimulatorState {
  running: boolean;
  rate: number;
  personas: Record<string, number>;
  shifted: Record<string, Record<string, number>>;
  mode: string;
  updatedAt: string | null;
  stats: Record<string, number>;
}

export const DEFAULT_SIMULATOR_STATE: SimulatorState = {
  running: false,
  rate: 2,
  personas: {},
  shifted: {},
  mode: 'live',
  updatedAt: null,
  stats: {},
};

export interface PersonaTruth {
  sessions: number;
  segments: Record<string, number>;
  toneMultipliers: Record<string, number>;
  impressions: number;
  clicks: number;
}

export function bestTone(multipliers: Record<string, number>): string {
  return (
    Object.entries(multipliers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'unknown'
  );
}

export function majoritySegment(segments: Record<string, number>): { key: string | null; share: number } {
  const total = Object.values(segments).reduce((s, v) => s + v, 0);
  const top = Object.entries(segments).sort((a, b) => b[1] - a[1])[0];
  return top && total > 0 ? { key: top[0], share: top[1] / total } : { key: null, share: 0 };
}
