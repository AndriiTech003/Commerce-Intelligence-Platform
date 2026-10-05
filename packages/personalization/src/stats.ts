import { sampleBeta } from './beta';
import { seededRandom, type Rng } from './random';

export interface Interval {
  rate: number;
  low: number;
  high: number;
}

export function wilsonInterval(successes: number, trials: number, z = 1.959963984540054): Interval {
  if (trials <= 0) return { rate: 0, low: 0, high: 0 };
  const p = Math.min(Math.max(successes / trials, 0), 1);
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { rate: p, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function probabilityBest(
  arms: Array<{ alpha: number; beta: number }>,
  samples = 10000,
  rng: Rng = seededRandom(20240917),
): number[] {
  if (arms.length === 0) return [];
  if (arms.length === 1) return [1];
  const wins = new Array<number>(arms.length).fill(0);
  for (let i = 0; i < samples; i++) {
    let best = 0;
    let bestValue = -1;
    for (let j = 0; j < arms.length; j++) {
      const arm = arms[j]!;
      const value = sampleBeta(arm.alpha, arm.beta, rng);
      if (value > bestValue) {
        bestValue = value;
        best = j;
      }
    }
    wins[best]! += 1;
  }
  return wins.map((w) => w / samples);
}

export function expectedRegret(trueRates: number[], chosen: number): number {
  const best = Math.max(...trueRates);
  return best - (trueRates[chosen] ?? 0);
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}
