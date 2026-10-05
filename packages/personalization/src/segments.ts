import { z } from 'zod';

export const RULE_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'exists',
  'within_days',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export type FeatureValue = number | string | boolean | null | undefined;
export type FeatureMap = Record<string, FeatureValue>;

export interface RuleCondition {
  feature: string;
  op: RuleOperator;
  value?: unknown;
}

export type RuleGroup = { all: Rule[] } | { any: Rule[] };
export type Rule = RuleCondition | RuleGroup;

const scalar = z.union([z.string().max(200), z.number(), z.boolean()]);
const featureName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*(\.[a-zA-Z0-9_\- ]+)*$/, 'feature names look like aff.cat.running or intent');

export const ruleConditionSchema = z
  .object({ feature: featureName, op: z.enum(RULE_OPERATORS), value: z.unknown().optional() })
  .superRefine((condition, ctx) => {
    const { op, value } = condition;
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['value'] });
    if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${op} needs a number`);
    } else if (op === 'within_days') {
      if (typeof value !== 'number' || !(value > 0)) fail('within_days needs a positive number of days');
    } else if (op === 'in' || op === 'not_in') {
      if (!Array.isArray(value) || value.length === 0 || !value.every((v) => scalar.safeParse(v).success))
        fail(`${op} needs a non-empty list of values`);
    } else if (op === 'exists') {
      if (value !== undefined && typeof value !== 'boolean') fail('exists takes an optional boolean');
    } else if (!scalar.safeParse(value).success) {
      fail(`${op} needs a string, number or boolean`);
    }
  });

export const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ruleSchema).min(1).max(50) }).strict(),
    z.object({ any: z.array(ruleSchema).min(1).max(50) }).strict(),
    ruleConditionSchema,
  ]),
) as z.ZodType<Rule>;

export const segmentRulesSchema: z.ZodType<RuleGroup> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ruleSchema).min(1).max(50) }).strict(),
    z.object({ any: z.array(ruleSchema).min(1).max(50) }).strict(),
  ]),
) as z.ZodType<RuleGroup>;

export function isGroup(rule: Rule): rule is RuleGroup {
  return 'all' in rule || 'any' in rule;
}

export function ruleDepth(rule: Rule): number {
  if (!isGroup(rule)) return 0;
  const children = 'all' in rule ? rule.all : rule.any;
  return 1 + Math.max(0, ...children.map(ruleDepth));
}

const ZERO_DEFAULT = /^(aff\.|orders_count$|ltv_cents$|sessions_30d$|intent$)/;

export function featureValue(features: FeatureMap, name: string): FeatureValue {
  const value = features[name];
  if (value === undefined || value === null) {
    if (ZERO_DEFAULT.test(name)) return 0;
    if (name === 'used_discount') return false;
    return undefined;
  }
  return value;
}

const SYMBOL: Record<RuleOperator, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'in',
  not_in: 'not in',
  exists: 'exists',
  within_days: 'within days',
};

function show(value: unknown): string {
  if (typeof value === 'number') return String(Number(value.toFixed(2)));
  if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`;
  if (value === undefined || value === null) return '∅';
  return String(value);
}

function toTimestamp(value: FeatureValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function equals(a: FeatureValue, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

export function evaluateCondition(condition: RuleCondition, features: FeatureMap, now: number): boolean {
  const actual = featureValue(features, condition.feature);
  const expected = condition.value;
  switch (condition.op) {
    case 'eq':
      return equals(actual, expected);
    case 'neq':
      return !equals(actual, expected);
    case 'gt':
      return typeof actual === 'number' && actual > (expected as number);
    case 'gte':
      return typeof actual === 'number' && actual >= (expected as number);
    case 'lt':
      return typeof actual === 'number' && actual < (expected as number);
    case 'lte':
      return typeof actual === 'number' && actual <= (expected as number);
    case 'in':
      return Array.isArray(expected) && expected.some((v) => equals(actual, v));
    case 'not_in':
      return Array.isArray(expected) && !expected.some((v) => equals(actual, v));
    case 'exists': {
      const present = actual !== undefined && actual !== null && actual !== '' && actual !== 0;
      return expected === false ? !present : present;
    }
    case 'within_days': {
      const ts = toTimestamp(actual);
      return ts !== null && now - ts <= (expected as number) * 86_400_000 && ts <= now + 60_000;
    }
  }
}

export function describeCondition(condition: RuleCondition, features?: FeatureMap): string {
  const target = condition.op === 'exists' ? '' : ` ${show(condition.value)}`;
  if (!features) return `${condition.feature} ${SYMBOL[condition.op]}${target}`.trim();
  const actual = featureValue(features, condition.feature);
  if (condition.op === 'eq' || condition.op === 'in') return `${condition.feature} = ${show(actual)}`;
  if (condition.op === 'exists') return `${condition.feature} = ${show(actual)}`;
  if (condition.op === 'within_days') return `${condition.feature} within ${show(condition.value)} days`;
  return `${condition.feature} = ${show(actual)} ${SYMBOL[condition.op]}${target}`;
}

export function describeRule(rule: Rule): string {
  if (!isGroup(rule)) return describeCondition(rule);
  const children = 'all' in rule ? rule.all : rule.any;
  const joiner = 'all' in rule ? ' AND ' : ' OR ';
  const parts = children.map((child) => (isGroup(child) ? `(${describeRule(child)})` : describeRule(child)));
  return parts.join(joiner);
}

export interface RuleMatch {
  matched: boolean;
  reasons: string[];
}

export type CompiledRule = (features: FeatureMap, now?: number) => RuleMatch;

export function compileRule(rule: Rule): CompiledRule {
  if (!isGroup(rule)) {
    return (features, now = Date.now()) =>
      evaluateCondition(rule, features, now)
        ? { matched: true, reasons: [describeCondition(rule, features)] }
        : { matched: false, reasons: [] };
  }
  if ('all' in rule) {
    const children = rule.all.map(compileRule);
    return (features, now = Date.now()) => {
      const reasons: string[] = [];
      for (const child of children) {
        const result = child(features, now);
        if (!result.matched) return { matched: false, reasons: [] };
        reasons.push(...result.reasons);
      }
      return { matched: true, reasons };
    };
  }
  const children = rule.any.map(compileRule);
  return (features, now = Date.now()) => {
    for (const child of children) {
      const result = child(features, now);
      if (result.matched) return result;
    }
    return { matched: false, reasons: [] };
  };
}

export interface SegmentDefinition {
  key: string;
  name: string;
  rules: RuleGroup;
  priority: number;
  isSystem: boolean;
}

export interface CompiledSegment extends SegmentDefinition {
  match: CompiledRule;
}

export function compileSegments(definitions: SegmentDefinition[]): CompiledSegment[] {
  return [...definitions]
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
    .map((definition) => ({ ...definition, match: compileRule(definition.rules) }));
}

export interface SegmentMembership {
  key: string;
  name: string;
  priority: number;
  reasons: string[];
}

export function evaluateSegments(
  segments: CompiledSegment[],
  features: FeatureMap,
  now = Date.now(),
): SegmentMembership[] {
  const out: SegmentMembership[] = [];
  for (const segment of segments) {
    const result = segment.match(features, now);
    if (result.matched)
      out.push({ key: segment.key, name: segment.name, priority: segment.priority, reasons: result.reasons });
  }
  return out;
}

export const DEFAULT_SEGMENT = '_default';

export function primarySegment(
  memberships: SegmentMembership[],
  targetSegments: string[],
): SegmentMembership | null {
  const targets = new Set(targetSegments);
  const eligible = memberships.filter((m) => targets.size === 0 || targets.has(m.key));
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))[0]!;
}

export const SYSTEM_SEGMENTS: SegmentDefinition[] = [
  {
    key: 'high_intent',
    name: 'High intent',
    priority: 10,
    isSystem: true,
    rules: { all: [{ feature: 'intent', op: 'gte', value: 0.7 }] },
  },
  {
    key: 'vip',
    name: 'VIP (top 10% LTV)',
    priority: 20,
    isSystem: true,
    rules: {
      all: [
        { feature: 'orders_count', op: 'gte', value: 1 },
        { feature: 'ltv_cents', op: 'gte', value: 50000 },
      ],
    },
  },
  {
    key: 'lapsed',
    name: 'Lapsed customers',
    priority: 30,
    isSystem: true,
    rules: {
      all: [
        { feature: 'orders_count', op: 'gte', value: 1 },
        { feature: 'days_since_last_order', op: 'gt', value: 60 },
      ],
    },
  },
  {
    key: 'price_sensitive',
    name: 'Price sensitive',
    priority: 40,
    isSystem: true,
    rules: {
      any: [
        { feature: 'price.band', op: 'eq', value: 'low' },
        { feature: 'used_discount', op: 'eq', value: true },
      ],
    },
  },
  {
    key: 'returning_customer',
    name: 'Returning customers',
    priority: 50,
    isSystem: true,
    rules: { all: [{ feature: 'orders_count', op: 'gte', value: 1 }] },
  },
  {
    key: 'new_visitor',
    name: 'New visitors',
    priority: 60,
    isSystem: true,
    rules: {
      all: [
        { feature: 'sessions_30d', op: 'lte', value: 1 },
        { feature: 'orders_count', op: 'eq', value: 0 },
      ],
    },
  },
];

export function vipRules(thresholdCents: number): RuleGroup {
  return {
    all: [
      { feature: 'orders_count', op: 'gte', value: 1 },
      { feature: 'ltv_cents', op: 'gte', value: Math.max(1, Math.round(thresholdCents)) },
    ],
  };
}

export const KNOWN_FEATURES: Array<{
  name: string;
  kind: 'number' | 'string' | 'boolean' | 'date';
  help: string;
}> = [
  { name: 'aff.cat.<path>', kind: 'number', help: 'Decayed category affinity, e.g. aff.cat.running' },
  { name: 'aff.brand.<brand>', kind: 'number', help: 'Decayed brand affinity' },
  { name: 'aff.tone.<tone>', kind: 'number', help: 'Clicks on creatives of a tone' },
  { name: 'price.band', kind: 'string', help: 'low | mid | high' },
  { name: 'price.ewma_cents', kind: 'number', help: 'EWMA of viewed and bought prices' },
  { name: 'intent', kind: 'number', help: '0..1 purchase intent in the last 30 minutes' },
  { name: 'sessions_30d', kind: 'number', help: 'Sessions in the last 30 days' },
  { name: 'orders_count', kind: 'number', help: 'Orders placed' },
  { name: 'ltv_cents', kind: 'number', help: 'Lifetime value in cents' },
  { name: 'used_discount', kind: 'boolean', help: 'Bought with a discount code' },
  { name: 'last_seen_at', kind: 'date', help: 'Last activity' },
  { name: 'last_order_at', kind: 'date', help: 'Last order' },
  { name: 'days_since_last_order', kind: 'number', help: 'Days since the last order' },
  { name: 'days_since_last_seen', kind: 'number', help: 'Days since the last activity' },
];
