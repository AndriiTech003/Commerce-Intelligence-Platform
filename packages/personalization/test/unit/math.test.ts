import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  betaMean,
  betaPdf,
  betaVariance,
  isHoldout,
  logGamma,
  parseBanditHash,
  probabilityBest,
  sampleBeta,
  sampleGamma,
  seededRandom,
  thompsonChoose,
  uniformChoose,
  wilsonInterval,
  bucketOf,
} from '../../src';

function moments(values: number[]) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1);
  return { mean, variance };
}

describe('seeded PRNG', () => {
  it('is deterministic per seed and uniform on [0, 1)', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const xs = Array.from({ length: 50000 }, () => a());
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const { mean, variance } = moments(xs);
    expect(mean).toBeCloseTo(0.5, 2);
    expect(variance).toBeCloseTo(1 / 12, 2);
    expect(seededRandom(8)()).not.toBe(seededRandom(7)());
  });

  it('hash buckets are stable and spread', () => {
    expect(bucketOf('profile-1:campaign-1')).toBe(bucketOf('profile-1:campaign-1'));
    const holdout = Array.from({ length: 20000 }, (_, i) => isHoldout(bucketOf(`p${i}:c`))).filter(Boolean);
    expect(holdout.length / 20000).toBeGreaterThan(0.085);
    expect(holdout.length / 20000).toBeLessThan(0.115);
  });
});

describe('Marsaglia–Tsang gamma and Beta sampler', () => {
  it.each([
    [0.5, 1],
    [1, 1],
    [2.5, 1],
    [9, 1],
  ])('Gamma(%s) has mean k and variance k on 100k samples', (shape) => {
    const rng = seededRandom(11);
    const values = Array.from({ length: 100000 }, () => sampleGamma(shape, rng));
    const { mean, variance } = moments(values);
    expect(Math.abs(mean - shape) / shape).toBeLessThan(0.02);
    expect(Math.abs(variance - shape) / shape).toBeLessThan(0.05);
  });

  it.each([
    [1, 1],
    [2, 5],
    [30, 70],
    [0.5, 0.5],
    [181, 3420],
  ])('Beta(%s, %s) matches analytic mean and variance on 100k samples', (alpha, beta) => {
    const rng = seededRandom(20260101);
    const values = Array.from({ length: 100000 }, () => sampleBeta(alpha, beta, rng));
    const { mean, variance } = moments(values);
    expect(values.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.abs(mean - betaMean(alpha, beta))).toBeLessThan(0.01 * Math.max(betaMean(alpha, beta), 0.05));
    expect(Math.abs(variance - betaVariance(alpha, beta)) / betaVariance(alpha, beta)).toBeLessThan(0.05);
  });

  it('is reproducible with the same seed', () => {
    const a = seededRandom(3);
    const b = seededRandom(3);
    expect(Array.from({ length: 10 }, () => sampleBeta(3, 4, a))).toEqual(
      Array.from({ length: 10 }, () => sampleBeta(3, 4, b)),
    );
  });

  it('log-gamma and the Beta pdf integrate correctly', () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 8);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
    for (const [a, b] of [
      [2, 3],
      [10, 40],
      [1, 1],
    ] as const) {
      let area = 0;
      const steps = 20000;
      for (let i = 0; i < steps; i++) area += betaPdf((i + 0.5) / steps, a, b) / steps;
      expect(area).toBeCloseTo(1, 3);
    }
  });
});

describe('Wilson interval and P(best)', () => {
  it('matches reference values', () => {
    const i = wilsonInterval(52, 1000);
    expect(i.rate).toBeCloseTo(0.052, 6);
    expect(i.low).toBeCloseTo(0.0399, 3);
    expect(i.high).toBeCloseTo(0.0676, 3);
    expect(wilsonInterval(0, 0)).toEqual({ rate: 0, low: 0, high: 0 });
    const zero = wilsonInterval(0, 10);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0.2);
  });

  it('stays within [0, 1] and contains the rate', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), fc.double({ min: 0, max: 1, noNaN: true }), (n, p) => {
        const s = Math.round(n * p);
        const i = wilsonInterval(s, n);
        return i.low >= 0 && i.high <= 1 && i.low <= i.rate + 1e-12 && i.high >= i.rate - 1e-12;
      }),
    );
  });

  it('P(best) sums to 1 and favours the clearly better arm', () => {
    const p = probabilityBest(
      [
        { alpha: 1 + 92, beta: 1 + 1840 - 92 },
        { alpha: 1 + 19, beta: 1 + 610 - 19 },
        { alpha: 1 + 11, beta: 1 + 402 - 11 },
      ],
      10000,
    );
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(p[0]).toBeGreaterThan(0.85);
    expect(probabilityBest([{ alpha: 3, beta: 3 }])).toEqual([1]);
    const tie = probabilityBest(
      [
        { alpha: 50, beta: 50 },
        { alpha: 50, beta: 50 },
      ],
      10000,
    );
    expect(Math.abs(tie[0]! - 0.5)).toBeLessThan(0.03);
  });
});

describe('bandit math', () => {
  it('parses the Redis hash with Beta(1,1) priors for unseen arms', () => {
    const arms = parseBanditHash({ 'c1:a': '5', 'c1:b': '96', 'c1:n': '100', 'c1:s': '4' }, ['c1', 'c2']);
    expect(arms[0]).toEqual({ creativeId: 'c1', alpha: 5, beta: 96, impressions: 100, successes: 4 });
    expect(arms[1]).toEqual({ creativeId: 'c2', alpha: 1, beta: 1, impressions: 0, successes: 0 });
  });

  it('serves arms uniformly during warm-up', () => {
    const rng = seededRandom(5);
    const arms = parseBanditHash({ 'a:n': '60', 'a:a': '30', 'a:b': '31' }, ['a', 'b', 'c']);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 3000; i++) {
      const choice = thompsonChoose(arms, rng);
      expect(choice.policy).toBe('warmup');
      counts[choice.chosen]! += 1;
    }
    expect(counts.a).toBe(0);
    expect(Math.abs(counts.b! - counts.c!)).toBeLessThan(200);
  });

  it('Thompson sampling converges on the best arm in a simulated run', () => {
    const rng = seededRandom(42);
    const truth = [0.03, 0.054, 0.027, 0.033];
    const state = truth.map((_, i) => ({
      creativeId: `c${i}`,
      alpha: 1,
      beta: 1,
      impressions: 0,
      successes: 0,
    }));
    let regret = 0;
    let uniformRegret = 0;
    for (let t = 0; t < 20000; t++) {
      const choice = thompsonChoose(state, rng);
      const index = Number(choice.chosen.slice(1));
      const arm = state[index]!;
      arm.impressions += 1;
      if (rng() < truth[index]!) {
        arm.successes += 1;
        arm.alpha += 1;
      } else arm.beta += 1;
      regret += 0.054 - truth[index]!;
      uniformRegret += 0.054 - truth[Number(uniformChoose(state, rng).chosen.slice(1))]!;
    }
    const pBest = probabilityBest(state.map((s) => ({ alpha: s.alpha, beta: s.beta })));
    expect(pBest.indexOf(Math.max(...pBest))).toBe(1);
    expect(state[1]!.impressions).toBeGreaterThan(10000);
    expect(regret).toBeLessThan(uniformRegret / 2);
  });
});
