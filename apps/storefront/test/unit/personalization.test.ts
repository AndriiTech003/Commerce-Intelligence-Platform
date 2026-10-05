import { describe, expect, it } from 'vitest';
import { DEMO_KEY, demoParam, readDemo, writeDemo } from '@/lib/demo-mode';
import {
  adClickProps,
  adImpressionProps,
  contributionShares,
  recommendationClickProps,
} from '@/lib/personalization';
import type { Decision } from '@/lib/types';

const decision: Decision = {
  decisionId: '01a0fc9e-c3e1-74c7-8752-9feece19f81c',
  placement: 'home_hero',
  campaignId: '01a0fc9a-4213-71f2-a4f6-8b40483c8026',
  creativeId: '01a0fc9a-4296-70cc-9310-439fcc07e5ca',
  segmentKey: '_default',
  policy: 'thompson_sampling',
  creative: {
    headline: 'Built for your next 10K',
    body: 'Light and fast.',
    cta: 'Shop now',
    tone: 'performance',
  },
  products: [
    {
      id: '01a0fc9a-35e1-70f1-8c52-dc08377ae0db',
      title: 'Velocity Pro Stride',
      slug: 'velocity-pro-stride',
      brand: 'Velocity',
      priceMinCents: 16199,
      compareAtCents: null,
      currency: 'USD',
      categoryPath: 'running.running_shoes.road_shoes',
      imageUrl: null,
      available: true,
    },
    {
      id: '01a0fc9a-3716-7692-ab62-0f4b1ef3e5a5',
      title: 'Mountain Co 8L Rucksack',
      slug: 'mountain-co-8l-rucksack',
      brand: null,
      priceMinCents: 10199,
      compareAtCents: null,
      currency: 'USD',
      categoryPath: 'hiking.backpacks',
      imageUrl: null,
      available: true,
    },
  ],
};

describe('campaign tracking payloads', () => {
  it('builds ad_impression props', () => {
    expect(adImpressionProps(decision)).toEqual({
      decision_id: decision.decisionId,
      campaign_id: decision.campaignId,
      creative_id: decision.creativeId,
      placement: 'home_hero',
      segment_key: '_default',
      policy: 'thompson_sampling',
      tone: 'performance',
    });
  });

  it('adds the first product category to CTA clicks', () => {
    expect(adClickProps(decision, null)).toMatchObject({
      decision_id: decision.decisionId,
      target: 'cta',
      category_path: 'running.running_shoes.road_shoes',
    });
  });

  it('adds the clicked product to product clicks', () => {
    const product = decision.products[1]!;
    expect(adClickProps(decision, { product, position: 1 })).toMatchObject({
      target: 'product',
      product_id: product.id,
      position: 1,
      category_path: 'hiking.backpacks',
    });
  });

  it('builds recommendation_clicked props with the first strategy', () => {
    expect(
      recommendationClickProps(
        { decisionId: decision.decisionId, type: 'for_you' },
        { id: 'p1', strategies: ['vector_profile', 'global_popular'], categoryPath: null },
        3,
      ),
    ).toEqual({
      decision_id: decision.decisionId,
      product_id: 'p1',
      position: 3,
      strategy: 'vector_profile',
      recommendation_type: 'for_you',
    });
  });

  it('converts contributions into bar widths', () => {
    const shares = contributionShares({
      similarity: 0.29,
      affinity: 0.25,
      popularity: 0,
      priceFit: -0.1,
      freshness: Number.NaN,
    });
    expect(shares.map((share) => Math.round(share.percent))).toEqual([29, 25, 0, 0, 0]);
  });
});

describe('demo mode', () => {
  it('parses the demo query parameter', () => {
    expect(demoParam('?demo=1')).toBe(true);
    expect(demoParam('?demo=0')).toBe(false);
    expect(demoParam('?q=shoes')).toBeNull();
  });

  it('persists the flag in storage', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
    expect(readDemo(storage)).toBe(false);
    writeDemo(storage, true);
    expect(map.get(DEMO_KEY)).toBe('1');
    expect(readDemo(storage)).toBe(true);
    writeDemo(storage, false);
    expect(readDemo(storage)).toBe(false);
    expect(readDemo(null)).toBe(false);
  });
});
