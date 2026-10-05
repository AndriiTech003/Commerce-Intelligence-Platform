import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDomainEvent, parseTrackEvent } from '@cip/contracts';
import { seededRandom } from '@cip/personalization';
import {
  backfillSession,
  clickProbability,
  effectiveMultipliers,
  inPersonaCategories,
  parsePersonas,
  personasPath,
  pickPersona,
  pickProduct,
  planSession,
  regretStep,
  StoreClient,
  trueBestTone,
  type CatalogProduct,
} from '../../src';

const personas = parsePersonas(readFileSync(personasPath(), 'utf8'));
const byKey = Object.fromEntries(personas.map((p) => [p.key, p]));

const paths = [
  'running.running_shoes.road_shoes',
  'running.running_shoes.trail_shoes',
  'running.running_apparel',
  'hiking.hiking_boots',
  'hiking.backpacks',
  'accessories.watches',
  'accessories.nutrition',
];
const products: CatalogProduct[] = Array.from({ length: 140 }, (_, i) => ({
  id: `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
  title: `Product ${i}`,
  slug: `product-${i}`,
  priceMinCents: 1000 + (i % 20) * 2500,
  categoryPath: paths[i % paths.length]!,
  brand: 'Brand',
}));

describe('persona file', () => {
  it('declares the five personas with hidden tone multipliers and distinct best tones for the main four', () => {
    expect(personas.map((p) => p.key)).toEqual([
      'marathon_runner',
      'weekend_hiker',
      'bargain_hunter',
      'gift_buyer',
      'window_shopper',
    ]);
    expect(personas.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1, 9);
    const best = ['marathon_runner', 'weekend_hiker', 'bargain_hunter', 'gift_buyer'].map((k) =>
      trueBestTone(byKey[k]!.tone_multipliers),
    );
    expect(best).toEqual(['performance', 'lifestyle', 'value', 'premium']);
  });
});

describe('behaviour model', () => {
  it('picks personas according to their shares (or an override mix)', () => {
    const rand = seededRandom(1);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) {
      const p = pickPersona(personas, rand);
      counts[p.key] = (counts[p.key] ?? 0) + 1;
    }
    expect(counts.marathon_runner! / 20000).toBeCloseTo(0.3, 1);
    expect(counts.window_shopper! / 20000).toBeCloseTo(0.1, 1);
    const only = pickPersona(personas, rand, {
      gift_buyer: 1,
      marathon_runner: 0,
      weekend_hiker: 0,
      bargain_hunter: 0,
      window_shopper: 0,
    });
    expect(only.key).toBe('gift_buyer');
  });

  it('browses products from the persona categories near its price', () => {
    const rand = seededRandom(2);
    const persona = byKey.bargain_hunter!;
    const picks = Array.from({ length: 2000 }, () => pickProduct(products, persona, rand)!);
    expect(picks.filter((p) => inPersonaCategories(p, persona)).length / picks.length).toBeGreaterThan(0.99);
    const mean = picks.reduce((s, p) => s + (p.priceMinCents ?? 0), 0) / picks.length / 100;
    const gift = Array.from({ length: 2000 }, () => pickProduct(products, byKey.gift_buyer!, rand)!);
    const giftMean = gift.reduce((s, p) => s + (p.priceMinCents ?? 0), 0) / gift.length / 100;
    expect(mean).toBeLessThan(giftMean);
  });

  it('click probability = base CTR × tone multiplier × relevance, and shifts override the hidden truth', () => {
    const runner = byKey.marathon_runner!;
    const onTopic = [{ categoryPath: 'running.running_apparel' }];
    expect(clickProbability(runner, 'performance', onTopic)).toBeCloseTo(0.08 * 1.8 * 1.25, 9);
    expect(clickProbability(runner, 'lifestyle', [{ categoryPath: 'coffee.blends' }])).toBeCloseTo(
      0.08 * 0.8 * 0.75,
      9,
    );
    const shifted = { marathon_runner: { performance: 0.5, lifestyle: 2.5 } };
    expect(trueBestTone(effectiveMultipliers(runner, shifted))).toBe('lifestyle');
    expect(clickProbability(runner, 'lifestyle', onTopic, shifted)).toBeGreaterThan(
      clickProbability(runner, 'performance', onTopic, shifted),
    );
  });

  it('regret is measured against the oracle for both the served arm and a uniform shadow policy', () => {
    const step = regretStep({ a: 0.09, b: 0.04, c: 0.05 }, 'b');
    expect(step.thompson).toBeCloseTo(0.05, 9);
    expect(step.uniform).toBeCloseTo(0.09 - 0.06, 9);
    expect(regretStep({ a: 0.09, b: 0.04 }, 'a').thompson).toBe(0);
  });

  it('session funnel follows the persona probabilities', () => {
    const rand = seededRandom(3);
    const persona = byKey.marathon_runner!;
    const plans = Array.from({ length: 20000 }, () => planSession(persona, rand));
    const carts = plans.filter((p) => p.addToCart).length / plans.length;
    const purchases = plans.filter((p) => p.purchase).length / plans.length;
    expect(carts).toBeCloseTo(0.18, 1);
    expect(purchases).toBeCloseTo(0.18 * 0.55 * 0.8, 1);
    expect(plans.every((p) => p.views >= 1)).toBe(true);
    expect(plans.filter((p) => p.useDiscount).length).toBe(0);
  });

  it('backfill sessions produce valid track and domain events in the past', () => {
    const client = new StoreClient('http://x', 'http://y', 'runhub');
    client.info = {
      id: '0190a000-0000-7000-8000-00000000abcd',
      slug: 'runhub',
      trackingKey: 'pk',
      currency: 'USD',
    };
    client.products = products;
    const rand = seededRandom(4);
    const start = Date.now() - 30 * 86_400_000;
    let domain = 0;
    for (let i = 0; i < 200; i++) {
      for (const m of backfillSession(
        client,
        byKey.gift_buyer!,
        rand,
        start,
        '0190a000-0000-7000-8000-00000000ffff',
      )) {
        const body = m.body as { event_type: string; occurred_at: string };
        expect(Date.parse(body.occurred_at)).toBeLessThan(Date.now());
        if (body.event_type.includes('.')) {
          domain += 1;
          expect(parseDomainEvent(m.body).ok).toBe(true);
        } else expect(parseTrackEvent(m.body).ok).toBe(true);
      }
    }
    expect(domain).toBeGreaterThan(0);
  });
});
