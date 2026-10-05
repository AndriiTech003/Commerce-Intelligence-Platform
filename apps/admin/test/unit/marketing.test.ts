import { segmentRulesSchema } from '@cip/personalization';
import { describe, expect, it } from 'vitest';
import { blockingFlags, patchCampaignCreatives, patchReviewQueue } from '../../src/lib/creatives';
import { csvTemplate, CSV_COLUMNS } from '../../src/lib/csv';
import { readDecision } from '../../src/lib/decision';
import {
  densityCurves,
  densityRange,
  formatInterval,
  historySeries,
  lift,
  niceTicks,
  parseBucket,
  trafficShare,
} from '../../src/lib/experiment';
import { visibleNav } from '../../src/components/nav';
import {
  addChild,
  conditionValue,
  countConditions,
  featureOptions,
  fromRules,
  newCondition,
  newGroup,
  removeNode,
  setGroupMode,
  slugKey,
  toRules,
  treeDepth,
  updateCondition,
  validateTree,
  type ConditionNode,
  type GroupNode,
} from '../../src/lib/rule-tree';
import { normalizeShares } from '../../src/lib/simulator';
import { isJobDone, jobProgress } from '../../src/lib/jobs';

const RULES = {
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
};

const OPTIONS = [
  { name: 'price.band', kind: 'string' as const, help: '' },
  { name: 'intent', kind: 'number' as const, help: '' },
  { name: 'orders_count', kind: 'number' as const, help: '' },
  { name: 'used_discount', kind: 'boolean' as const, help: '' },
];

describe('rule builder tree', () => {
  it('round-trips rules through the editor tree', () => {
    const tree = fromRules(RULES);
    expect(countConditions(tree)).toBe(4);
    expect(treeDepth(tree)).toBe(2);
    const back = toRules(tree, OPTIONS);
    expect(back).toEqual(RULES);
    expect(segmentRulesSchema.safeParse(back).success).toBe(true);
    expect(validateTree(tree, OPTIONS)).toEqual([]);
  });

  it('adds, updates and removes nodes immutably', () => {
    const root = newGroup('all', [newCondition('intent', 'gte', '0.5')]);
    const nested = newGroup('any', [newCondition('orders_count', 'gte', '1')]);
    const withGroup = addChild(root, root.id, nested);
    expect(root.children).toHaveLength(1);
    expect(withGroup.children).toHaveLength(2);
    const condition = withGroup.children[0] as ConditionNode;
    const updated = updateCondition(withGroup, condition.id, { op: 'exists' });
    expect((updated.children[0] as ConditionNode).value).toBe('');
    const switched = setGroupMode(updated, nested.id, 'all');
    expect((switched.children[1] as GroupNode).mode).toBe('all');
    const removed = removeNode(switched, nested.id);
    expect(removed.children).toHaveLength(1);
    expect(removeNode(removed, removed.id)).toBe(removed);
  });

  it('parses values according to operator and feature kind', () => {
    expect(conditionValue(newCondition('price.band', 'in', 'low, mid'), 'string')).toEqual(['low', 'mid']);
    expect(conditionValue(newCondition('intent', 'gte', '0.7'), 'number')).toBe(0.7);
    expect(conditionValue(newCondition('used_discount', 'eq', 'true'), 'boolean')).toBe(true);
    expect(conditionValue(newCondition('price.band', 'eq', '1'), 'string')).toBe('1');
    expect(conditionValue(newCondition('last_seen_at', 'exists', ''), 'date')).toBeUndefined();
    expect(conditionValue(newCondition('last_seen_at', 'exists', 'false'), 'date')).toBe(false);
  });

  it('reports precise issues per node', () => {
    const bad = newCondition('intent', 'gte', '');
    const empty = newGroup('any', []);
    const tree = newGroup('all', [bad, empty, newCondition('aff.cat.<path>', 'gte', '1')]);
    const issues = validateTree(tree, OPTIONS);
    expect(issues.map((i) => i.nodeId)).toEqual([bad.id, empty.id, expect.any(String)]);
    expect(issues[0]!.message).toContain('number');
  });

  it('builds feature suggestions from categories, brands and tones', () => {
    const options = featureOptions(
      [{ name: 'aff.cat.<path>', kind: 'number', help: '' }, ...OPTIONS],
      ['running', 'running.shoes'],
      ['Pulse'],
      ['value'],
    );
    const names = options.map((o) => o.name);
    expect(names).toContain('aff.cat.running.shoes');
    expect(names).toContain('aff.brand.Pulse');
    expect(names).toContain('aff.tone.value');
    expect(names).not.toContain('aff.cat.<path>');
  });

  it('derives segment keys from names', () => {
    expect(slugKey('High-intent Runners 2026')).toBe('high_intent_runners_2026');
    expect(slugKey('  42 Fans')).toBe('fans');
  });
});

describe('experiment helpers', () => {
  const points = [
    { t: '2026-10-02 12:00:00', segmentKey: 'a', creativeId: 'c1', decisions: 3 },
    { t: '2026-10-02 12:00:00', segmentKey: 'a', creativeId: 'c2', decisions: 1 },
    { t: '2026-10-02 12:01:00', segmentKey: 'a', creativeId: 'c2', decisions: 2 },
    { t: '2026-10-02 12:01:00', segmentKey: 'b', creativeId: 'c1', decisions: 2 },
  ];

  it('parses ClickHouse buckets as UTC', () => {
    expect(parseBucket('2026-10-02 12:00:00')).toBe(Date.UTC(2026, 9, 2, 12, 0, 0));
    expect(parseBucket('2026-10-02T12:00:00Z')).toBe(Date.UTC(2026, 9, 2, 12, 0, 0));
  });

  it('computes traffic share per time bucket', () => {
    const share = trafficShare(points, 'a');
    expect(share.creativeIds).toEqual(['c1', 'c2']);
    expect(share.totals).toEqual([4, 2]);
    expect(share.shares.c1).toEqual([75, 0]);
    expect(share.shares.c2).toEqual([25, 100]);
    const all = trafficShare(points, null);
    expect(all.shares.c1).toEqual([75, 50]);
    for (let i = 0; i < all.times.length; i++)
      expect(all.creativeIds.reduce((sum, id) => sum + all.shares[id]![i]!, 0)).toBeCloseTo(100);
  });

  it('zooms the density x range on the interesting region', () => {
    expect(densityRange([])).toEqual([0, 1]);
    expect(densityRange([{ alpha: 1, beta: 1, high: 0 }])).toEqual([0, 1]);
    const [low, high] = densityRange([
      { alpha: 53, beta: 948, high: 0.068 },
      { alpha: 31, beta: 970, high: 0.044 },
    ]);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0.068);
    expect(high).toBeLessThan(0.15);
  });

  it('samples density curves that narrow with more evidence', () => {
    const range: [number, number] = [0, 0.2];
    const [wide, narrow] = densityCurves(
      [
        { alpha: 6, beta: 95 },
        { alpha: 51, beta: 950 },
      ],
      range,
      200,
    );
    expect(wide!.points).toHaveLength(201);
    expect(narrow!.peak).toBeGreaterThan(wide!.peak);
  });

  it('picks round axis ticks', () => {
    expect(niceTicks(0, 0.26)).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25]);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 0)).toEqual([0]);
  });

  it('formats Wilson intervals and lift', () => {
    expect(formatInterval(0.052, 0.04, 0.068)).toBe('5.2% (4.0–6.8%)');
    expect(lift(0.06, 0.04)).toBeCloseTo(50);
    expect(lift(0.06, 0)).toBeNull();
  });

  it('builds posterior-mean history series', () => {
    const series = historySeries(
      [
        { snapshotAt: '2026-10-02T12:05:00Z', segmentKey: 'a', creativeId: 'c1', alpha: 3, beta: 7 },
        { snapshotAt: '2026-10-02T12:00:00Z', segmentKey: 'a', creativeId: 'c1', alpha: 1, beta: 1 },
        { snapshotAt: '2026-10-02T12:00:00Z', segmentKey: 'b', creativeId: 'c1', alpha: 1, beta: 3 },
      ],
      'a',
    );
    expect(series).toEqual([
      {
        creativeId: 'c1',
        points: [
          [Date.parse('2026-10-02T12:00:00Z'), 0.5],
          [Date.parse('2026-10-02T12:05:00Z'), 0.3],
        ],
      },
    ]);
    expect(historySeries([], null)).toEqual([]);
  });
});

describe('creatives and jobs', () => {
  const creative = {
    id: 'c1',
    campaignId: 'k',
    headline: 'h',
    body: 'b',
    cta: 'c',
    tone: 'value',
    targetSegment: null,
    status: 'draft' as const,
    source: 'llm' as const,
    generation: null,
    guardrailFlags: ['near_duplicate', 'unverified_claim'],
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: null,
    createdAt: '2026-10-02T00:00:00Z',
  };

  it('identifies approval-blocking flags', () => {
    expect(blockingFlags(creative.guardrailFlags)).toEqual(['unverified_claim']);
    expect(blockingFlags(['banned_claim'])).toEqual([]);
  });

  it('patches cached campaign creatives and review queue optimistically', () => {
    const detail = {
      id: 'k',
      name: 'n',
      placement: 'home_hero' as const,
      status: 'draft' as const,
      targetSegments: [],
      productSelector: {},
      goal: 'click' as const,
      startsAt: null,
      endsAt: null,
      createdAt: '',
      creativeCounts: {},
      creatives: [creative],
    };
    expect(
      patchCampaignCreatives(detail, 'c1', (c) => ({ ...c, status: 'approved' }))!.creatives[0]!.status,
    ).toBe('approved');
    const queue = { data: [{ ...creative, campaignName: 'n', placement: 'home_hero' }] };
    expect(patchReviewQueue(queue, 'c1', () => null)!.data).toEqual([]);
    expect(patchReviewQueue(undefined, 'c1', () => null)).toBeUndefined();
  });

  it('computes job progress', () => {
    expect(jobProgress(undefined)).toBe(0);
    expect(jobProgress({ processed: 5, total: 20, status: 'running' })).toBe(25);
    expect(jobProgress({ processed: 5, total: 20, status: 'completed' })).toBe(100);
    expect(isJobDone({ status: 'failed' })).toBe(true);
    expect(isJobDone({ status: 'running' })).toBe(false);
  });
});

describe('misc helpers', () => {
  it('reads decision explanations defensively', () => {
    const view = readDecision(
      {
        source: 'redis',
        decisionId: 'd1',
        campaignId: 'k',
        explanation: {
          segment: { key: 'high_intent', name: 'High intent', matchedRules: ['intent = 0.81 ≥ 0.7'] },
          creative: {
            chosen: 'c1',
            headline: 'H',
            policy: 'thompson_sampling',
            arms: [
              {
                id: 'c1',
                tone: 'value',
                headline: 'H',
                impressions: 10,
                ctr: 0.1,
                sampled: 0.12,
                pBest: 0.8,
              },
            ],
          },
          products: [
            { id: 'p1', score: 0.7, strategies: ['vector_profile'], contributions: { similarity: 0.3 } },
          ],
        },
      },
      'fallback',
    );
    expect(view.decisionId).toBe('d1');
    expect(view.segment.matchedRules).toHaveLength(1);
    expect(view.arms[0]!.pBest).toBe(0.8);
    expect(view.products[0]!.contributions.find((c) => c.key === 'similarity')!.value).toBe(0.3);
    expect(view.products[0]!.contributions.find((c) => c.key === 'freshness')!.value).toBe(0);
    expect(readDecision(null, 'x').decisionId).toBe('x');
  });

  it('normalizes persona shares', () => {
    expect(normalizeShares({ a: 1, b: 3 })).toEqual({ a: 0.25, b: 0.75 });
    expect(normalizeShares({ a: 0, b: -1 })).toEqual({ a: 0, b: 0 });
  });

  it('ships a CSV template with the importer columns', () => {
    const [header, ...rows] = csvTemplate().trim().split('\n');
    expect(header!.split(',')).toEqual([...CSV_COLUMNS]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('shows marketing and webhook navigation by permission', () => {
    const hrefs = visibleNav((p) => ['customers:read', 'settings:write'].includes(p), false).flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(hrefs).toContain('/marketing/segments');
    expect(hrefs).toContain('/settings/webhooks');
    expect(hrefs).not.toContain('/marketing/campaigns');
  });
});
