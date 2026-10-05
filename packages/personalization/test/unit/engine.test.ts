import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  compileRule,
  compileSegments,
  cosine,
  decayAdd,
  decayedScore,
  decayMerge,
  describeRule,
  embeddingText,
  evaluateSegments,
  hashEmbedding,
  HALF_LIFE_MS,
  intentFromState,
  intentScore,
  parseProfileHash,
  priceBand,
  priceFit,
  primarySegment,
  profileFeatures,
  profileSignals,
  rankCandidates,
  RANKING_WEIGHTS,
  ruleDepth,
  segmentRulesSchema,
  SYSTEM_SEGMENTS,
  type RankCandidate,
  type ScoreStamp,
} from '../../src';

const DAY = 86_400_000;

describe('exponential decay', () => {
  it('halves after one half-life', () => {
    expect(decayedScore({ score: 8, ts: 0 }, HALF_LIFE_MS)).toBeCloseTo(4, 9);
    expect(decayedScore({ score: 8, ts: 0 }, 2 * HALF_LIFE_MS)).toBeCloseTo(2, 9);
    expect(decayAdd({ score: 8, ts: 0 }, 1, 7 * DAY)).toEqual({ score: 5, ts: 7 * DAY });
  });

  it('is commutative: any processing order gives the same score', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ w: fc.constantFrom(1, 1.5, 2, 3, 5, -1), t: fc.integer({ min: 0, max: 60 * DAY }) }),
          { minLength: 1, maxLength: 30 },
        ),
        fc.integer({ min: 0, max: 1000 }),
        (events, seed) => {
          const apply = (list: typeof events) =>
            list.reduce<ScoreStamp | null>((acc, e) => decayAdd(acc, e.w, e.t), null)!;
          const shuffled = [...events].sort((a, b) => ((a.t * 31 + seed) % 97) - ((b.t * 31 + seed) % 97));
          const x = apply(events);
          const y = apply(shuffled);
          const at = 61 * DAY;
          return Math.abs(decayedScore(x, at) - decayedScore(y, at)) < 1e-6;
        },
      ),
    );
  });

  it('merging two profiles equals applying all events to one', () => {
    const a = [decayAdd(null, 3, DAY), 1, 2 * DAY] as const;
    const left = decayAdd(a[0], 1, 2 * DAY);
    const right = decayAdd(decayAdd(null, 5, 3 * DAY), 1, 4 * DAY);
    const merged = decayMerge(left, right);
    const all = [
      [3, DAY],
      [1, 2 * DAY],
      [5, 3 * DAY],
      [1, 4 * DAY],
    ].reduce<ScoreStamp | null>((acc, [w, t]) => decayAdd(acc, w!, t!), null)!;
    expect(decayedScore(merged, 10 * DAY)).toBeCloseTo(decayedScore(all, 10 * DAY), 9);
  });
});

describe('intent and price band', () => {
  it('saturates in 0..1 with the documented coefficients', () => {
    expect(intentScore({ views: 0, cartAdds: 0, checkoutStarted: 0, repeatViews: 0, searches: 0 })).toBe(0);
    expect(
      intentScore({ views: 4, cartAdds: 1, checkoutStarted: 1, repeatViews: 1, searches: 0 }),
    ).toBeCloseTo(1 - Math.exp(-(0.6 + 0.6 + 1.2 + 0.4)), 9);
    expect(
      intentScore({ views: 100, cartAdds: 10, checkoutStarted: 5, repeatViews: 9, searches: 9 }),
    ).toBeLessThan(1);
  });

  it('counts only the last 30 minutes and repeat views of the same product', () => {
    const now = 10 * DAY;
    const state = parseProfileHash('p', {
      ie: JSON.stringify([
        ['v', now - 60_000, 'a'],
        ['v', now - 50_000, 'a'],
        ['c', now - 40_000, 'a'],
        ['v', now - 45 * 60_000, 'b'],
      ]),
    });
    expect(intentFromState(state, now)).toBeCloseTo(1 - Math.exp(-(0.3 + 0.6 + 0.4)), 9);
  });

  it('classifies the EWMA against category quantiles', () => {
    expect(priceBand(4000, [5000, 12000])).toBe('low');
    expect(priceBand(9000, [5000, 12000])).toBe('mid');
    expect(priceBand(20000, [5000, 12000])).toBe('high');
    expect(priceBand(null, [5000, 12000])).toBeNull();
  });

  it('builds features and signals from the Redis hash', () => {
    const now = Date.UTC(2026, 9, 2);
    const state = parseProfileHash('p1', {
      'a:cat:running': `8.000000|${now}`,
      'a:cat:running.road_shoes': `5.000000|${now - 7 * DAY}`,
      pe: '11000',
      oc: '2',
      ltv: '25000',
      lo: String(now - 12 * DAY),
      ud: '1',
      ss: JSON.stringify({ s1: now - DAY, s2: now - 40 * DAY }),
      rp: JSON.stringify([['x', 1, now - 3600_000, 'running.road_shoes']]),
      v: '3',
    });
    const features = profileFeatures(state, { now, quantiles: { running: [8000, 15000] } });
    expect(features['aff.cat.running']).toBe(8);
    expect(features['aff.cat.running.road_shoes']).toBe(2.5);
    expect(features['price.band']).toBe('mid');
    expect(features.sessions_30d).toBe(1);
    expect(features.days_since_last_order).toBe(12);
    expect(features.used_discount).toBe(true);
    const signals = profileSignals(state, { now });
    expect(signals[0]).toBe('Viewed 1 running product in the last 24h');
    expect(signals.some((s) => s.startsWith('Placed 2 orders, the last one 12 days ago'))).toBe(true);
  });
});

describe('segment rule engine', () => {
  const rules = {
    all: [
      { feature: 'aff.cat.running', op: 'gte', value: 5 },
      { feature: 'price.band', op: 'in', value: ['mid', 'high'] },
      {
        any: [
          { feature: 'intent', op: 'gte', value: 0.6 },
          { feature: 'orders_count', op: 'gte', value: 1 },
        ],
      },
    ],
  } as const;

  it('validates rules with zod', () => {
    expect(segmentRulesSchema.safeParse(rules).success).toBe(true);
    expect(segmentRulesSchema.safeParse({ feature: 'intent', op: 'gte', value: 1 }).success).toBe(false);
    expect(
      segmentRulesSchema.safeParse({ all: [{ feature: 'intent', op: 'gte', value: 'x' }] }).success,
    ).toBe(false);
    expect(segmentRulesSchema.safeParse({ all: [{ feature: 'x', op: 'in', value: [] }] }).success).toBe(
      false,
    );
    expect(segmentRulesSchema.safeParse({ all: [{ feature: 'x', op: 'like', value: 1 }] }).success).toBe(
      false,
    );
    expect(segmentRulesSchema.safeParse({ all: [] }).success).toBe(false);
    expect(
      segmentRulesSchema.safeParse({ any: [{ feature: 'x', op: 'within_days', value: 0 }] }).success,
    ).toBe(false);
    expect(ruleDepth(rules as never)).toBe(2);
  });

  it('evaluates nested all/any and reports matched rules', () => {
    const match = compileRule(segmentRulesSchema.parse(rules));
    const result = match({ 'aff.cat.running': 8.2, 'price.band': 'mid', intent: 0.81, orders_count: 0 });
    expect(result).toEqual({
      matched: true,
      reasons: ['aff.cat.running = 8.2 ≥ 5', 'price.band = mid', 'intent = 0.81 ≥ 0.6'],
    });
    expect(match({ 'aff.cat.running': 8.2, 'price.band': 'low', intent: 0.9 }).matched).toBe(false);
    expect(match({ 'aff.cat.running': 3, 'price.band': 'mid', intent: 0.9 }).matched).toBe(false);
    expect(match({ 'aff.cat.running': 6, 'price.band': 'high', orders_count: 2 }).reasons[2]).toBe(
      'orders_count = 2 ≥ 1',
    );
    expect(describeRule(segmentRulesSchema.parse(rules))).toBe(
      'aff.cat.running ≥ 5 AND price.band in [mid, high] AND (intent ≥ 0.6 OR orders_count ≥ 1)',
    );
  });

  it('supports every operator', () => {
    const now = Date.UTC(2026, 0, 31);
    const f = { a: 5, s: 'x', b: true, d: new Date(now - 3 * DAY).toISOString(), z: 0 };
    const check = (rule: unknown) => compileRule(segmentRulesSchema.parse({ all: [rule] }))(f, now).matched;
    expect(check({ feature: 'a', op: 'eq', value: 5 })).toBe(true);
    expect(check({ feature: 'a', op: 'neq', value: 5 })).toBe(false);
    expect(check({ feature: 'a', op: 'gt', value: 4 })).toBe(true);
    expect(check({ feature: 'a', op: 'gte', value: 5 })).toBe(true);
    expect(check({ feature: 'a', op: 'lt', value: 5 })).toBe(false);
    expect(check({ feature: 'a', op: 'lte', value: 5 })).toBe(true);
    expect(check({ feature: 's', op: 'in', value: ['x', 'y'] })).toBe(true);
    expect(check({ feature: 's', op: 'not_in', value: ['x', 'y'] })).toBe(false);
    expect(check({ feature: 'b', op: 'exists' })).toBe(true);
    expect(check({ feature: 'missing', op: 'exists' })).toBe(false);
    expect(check({ feature: 'missing', op: 'exists', value: false })).toBe(true);
    expect(check({ feature: 'd', op: 'within_days', value: 7 })).toBe(true);
    expect(check({ feature: 'd', op: 'within_days', value: 2 })).toBe(false);
    expect(check({ feature: 'aff.cat.unknown', op: 'eq', value: 0 })).toBe(true);
    expect(check({ feature: 'used_discount', op: 'eq', value: false })).toBe(true);
  });

  it('picks the primary segment by priority among campaign targets', () => {
    const segments = compileSegments(SYSTEM_SEGMENTS);
    const memberships = evaluateSegments(segments, {
      intent: 0.9,
      orders_count: 2,
      'price.band': 'low',
      sessions_30d: 4,
      ltv_cents: 1000,
    });
    expect(memberships.map((m) => m.key)).toEqual(['high_intent', 'price_sensitive', 'returning_customer']);
    expect(primarySegment(memberships, ['returning_customer', 'price_sensitive'])?.key).toBe(
      'price_sensitive',
    );
    expect(primarySegment(memberships, ['vip'])).toBeNull();
    expect(primarySegment(memberships, [])?.key).toBe('high_intent');
  });
});

describe('ranking', () => {
  const now = Date.UTC(2026, 9, 1);
  const base = (id: string, extra: Partial<RankCandidate>): RankCandidate => ({
    id,
    brand: 'B',
    categoryPath: 'running.road_shoes',
    priceCents: 10000,
    createdAt: now - 90 * DAY,
    embedding: null,
    strategies: ['global_popular'],
    views7d: 10,
    ...extra,
  });

  it('computes the documented linear score with contributions', () => {
    const [item] = rankCandidates([base('a', { similarity: 0.8, views7d: 100, createdAt: now - 15 * DAY })], {
      now,
      affinity: { running: 10, 'running.road_shoes': 5 },
      priceEwmaCents: 10000,
      maxViews: 100,
      limit: 5,
    });
    expect(item!.features).toEqual({
      similarity: 0.8,
      affinity: 1,
      popularity: 1,
      priceFit: 1,
      freshness: 0.5,
    });
    expect(item!.contributions.similarity).toBeCloseTo(0.28, 9);
    expect(item!.score).toBeCloseTo(0.35 * 0.8 + 0.25 + 0.15 + 0.15 + 0.05, 9);
    expect(Object.values(item!.contributions).reduce((s, v) => s + v, 0)).toBeCloseTo(item!.score, 12);
    expect(Object.values(RANKING_WEIGHTS).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });

  it('price fit follows 1 − |log(p/ewma)| / log(3)', () => {
    expect(priceFit(30000, 10000)).toBeCloseTo(0, 9);
    expect(priceFit(10000, 10000)).toBe(1);
    expect(priceFit(5000, 10000)).toBeCloseTo(1 - Math.log(2) / Math.log(3), 9);
    expect(priceFit(10000, null)).toBe(0.5);
  });

  it('filters out of stock, recently purchased and excluded items', () => {
    const ranked = rankCandidates(
      [
        base('a', {}),
        base('b', { inStock: false }),
        base('c', {}),
        base('d', {}),
        base('e', { status: 'draft' }),
      ],
      {
        now,
        affinity: {},
        priceEwmaCents: null,
        maxViews: 10,
        limit: 10,
        excludeIds: new Set(['c']),
        purchasedAt: { d: now - 5 * DAY, a: now - 40 * DAY },
        brandCap: 10,
      },
    );
    expect(ranked.map((r) => r.id)).toEqual(['a']);
  });

  it('caps two items per brand and diversifies with MMR', () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    const candidates = [
      base('a1', { brand: 'A', similarity: 0.9, embedding: v1 }),
      base('a2', { brand: 'A', similarity: 0.89, embedding: v1 }),
      base('a3', { brand: 'A', similarity: 0.88, embedding: v1 }),
      base('b1', { brand: 'B', similarity: 0.87, embedding: v1 }),
      base('c1', { brand: 'C', similarity: 0.6, embedding: v2 }),
    ];
    const ranked = rankCandidates(candidates, {
      now,
      affinity: {},
      priceEwmaCents: null,
      maxViews: 10,
      limit: 4,
    });
    const ids = ranked.map((r) => r.id);
    expect(ids.filter((id) => id.startsWith('a'))).toHaveLength(2);
    expect(ids[0]).toBe('a1');
    expect(ids.indexOf('c1')).toBeLessThan(ids.indexOf('b1'));
  });
});

describe('embeddings', () => {
  it('hash embedder is deterministic, normalised and lexically meaningful', () => {
    const shoe = hashEmbedding(
      embeddingText({
        title: 'Stridewell Swift Runner',
        brand: 'Stridewell',
        categoryPath: 'running.road_shoes',
      }),
    );
    const shoe2 = hashEmbedding(
      embeddingText({ title: 'Velocity Swift Tempo', brand: 'Velocity', categoryPath: 'running.road_shoes' }),
    );
    const coffee = hashEmbedding(
      embeddingText({
        title: 'Ethiopia Natural',
        brand: 'Roastery 47',
        categoryPath: 'coffee.single_origin',
      }),
    );
    expect(shoe).toHaveLength(384);
    expect(Math.sqrt(shoe.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1, 9);
    expect(hashEmbedding('same text')).toEqual(hashEmbedding('same text'));
    expect(cosine(shoe, shoe2)).toBeGreaterThan(cosine(shoe, coffee));
  });

  it('builds the documented embedding text', () => {
    expect(
      embeddingText({
        title: 'Trail X',
        brand: 'Mountain Co',
        categoryPath: 'running.trail_shoes',
        attributes: { terrain: 'trail' },
        tags: ['running'],
        description: '**Trail X** by Mountain Co.',
      }),
    ).toBe('Trail X | Mountain Co | running trail shoes | terrain: trail; running | Trail X by Mountain Co.');
  });
});
