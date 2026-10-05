import { RULE_OPERATORS, ruleConditionSchema, type RuleOperator } from '@cip/personalization';

export type GroupMode = 'all' | 'any';
export type FeatureKind = 'number' | 'string' | 'boolean' | 'date';
export type ValueMode = 'none' | 'number' | 'list' | 'scalar';

export interface ConditionNode {
  id: string;
  kind: 'condition';
  feature: string;
  op: RuleOperator;
  value: string;
}

export interface GroupNode {
  id: string;
  kind: 'group';
  mode: GroupMode;
  children: RuleNode[];
}

export type RuleNode = ConditionNode | GroupNode;

export interface FeatureOption {
  name: string;
  kind: FeatureKind;
  help: string;
}

export const MAX_RULE_DEPTH = 5;

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  eq: '= equals',
  neq: '≠ not equal',
  gt: '> greater than',
  gte: '≥ at least',
  lt: '< less than',
  lte: '≤ at most',
  in: 'in list',
  not_in: 'not in list',
  exists: 'exists',
  within_days: 'within days',
};

export const OPERATORS: readonly RuleOperator[] = RULE_OPERATORS;

let sequence = 0;

export function nodeId(): string {
  sequence += 1;
  return `n${sequence}`;
}

export function newCondition(feature = 'intent', op: RuleOperator = 'gte', value = '0.5'): ConditionNode {
  return { id: nodeId(), kind: 'condition', feature, op, value };
}

export function newGroup(mode: GroupMode = 'all', children?: RuleNode[]): GroupNode {
  return { id: nodeId(), kind: 'group', mode, children: children ?? [newCondition()] };
}

export function valueMode(op: RuleOperator): ValueMode {
  if (op === 'exists') return 'none';
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte' || op === 'within_days') return 'number';
  if (op === 'in' || op === 'not_in') return 'list';
  return 'scalar';
}

function valueToText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(valueToText).join(', ');
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperator(value: unknown): value is RuleOperator {
  return typeof value === 'string' && (RULE_OPERATORS as readonly string[]).includes(value);
}

export function fromRules(rules: unknown): GroupNode {
  const convert = (rule: unknown): RuleNode => {
    if (isRecord(rule) && Array.isArray(rule.all)) return newGroup('all', rule.all.map(convert));
    if (isRecord(rule) && Array.isArray(rule.any)) return newGroup('any', rule.any.map(convert));
    if (isRecord(rule)) {
      return newCondition(
        typeof rule.feature === 'string' ? rule.feature : '',
        isOperator(rule.op) ? rule.op : 'eq',
        valueToText(rule.value),
      );
    }
    return newCondition('', 'eq', '');
  };
  const root = convert(rules);
  return root.kind === 'group' ? root : newGroup('all', [root]);
}

export function parseScalar(raw: string, kind?: FeatureKind): string | number | boolean {
  const text = raw.trim();
  if (kind === 'string') return text;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (kind !== 'date' && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

export function conditionValue(node: ConditionNode, kind?: FeatureKind): unknown {
  const mode = valueMode(node.op);
  const text = node.value.trim();
  if (mode === 'none') {
    if (text === 'false') return false;
    if (text === 'true') return true;
    return undefined;
  }
  if (mode === 'number') return text === '' ? undefined : Number(text);
  if (mode === 'list')
    return text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => parseScalar(part, kind));
  return text === '' ? undefined : parseScalar(text, kind);
}

export function featureKind(name: string, options: FeatureOption[] = []): FeatureKind | undefined {
  if (name.startsWith('aff.')) return 'number';
  return options.find((o) => o.name === name)?.kind;
}

export function toRules(root: GroupNode, options: FeatureOption[] = []): Record<string, unknown> {
  const convert = (node: RuleNode): Record<string, unknown> => {
    if (node.kind === 'group') return { [node.mode]: node.children.map(convert) };
    const value = conditionValue(node, featureKind(node.feature, options));
    return value === undefined
      ? { feature: node.feature.trim(), op: node.op }
      : { feature: node.feature.trim(), op: node.op, value };
  };
  return convert(root);
}

function mapTree(node: RuleNode, fn: (node: RuleNode) => RuleNode): RuleNode {
  const next = fn(node);
  if (next.kind !== 'group') return next;
  return { ...next, children: next.children.map((child) => mapTree(child, fn)) };
}

export function updateCondition(
  root: GroupNode,
  id: string,
  patch: Partial<Pick<ConditionNode, 'feature' | 'op' | 'value'>>,
): GroupNode {
  return mapTree(root, (node) => {
    if (node.id !== id || node.kind !== 'condition') return node;
    const next = { ...node, ...patch };
    if (patch.op && valueMode(patch.op) === 'none' && valueMode(node.op) !== 'none') next.value = '';
    return next;
  }) as GroupNode;
}

export function setGroupMode(root: GroupNode, id: string, mode: GroupMode): GroupNode {
  return mapTree(root, (node) =>
    node.id === id && node.kind === 'group' ? { ...node, mode } : node,
  ) as GroupNode;
}

export function addChild(root: GroupNode, groupId: string, child: RuleNode): GroupNode {
  return mapTree(root, (node) =>
    node.id === groupId && node.kind === 'group' ? { ...node, children: [...node.children, child] } : node,
  ) as GroupNode;
}

export function removeNode(root: GroupNode, id: string): GroupNode {
  if (root.id === id) return root;
  const prune = (node: RuleNode): RuleNode => {
    if (node.kind !== 'group') return node;
    return { ...node, children: node.children.filter((child) => child.id !== id).map(prune) };
  };
  return prune(root) as GroupNode;
}

export function treeDepth(node: RuleNode): number {
  if (node.kind !== 'group') return 0;
  return 1 + Math.max(0, ...node.children.map(treeDepth));
}

export function nodeDepth(root: GroupNode, id: string): number {
  const walk = (node: RuleNode, depth: number): number => {
    if (node.id === id) return depth;
    if (node.kind !== 'group') return -1;
    for (const child of node.children) {
      const found = walk(child, depth + 1);
      if (found >= 0) return found;
    }
    return -1;
  };
  return walk(root, 1);
}

export function countConditions(node: RuleNode): number {
  if (node.kind !== 'group') return 1;
  return node.children.reduce((sum, child) => sum + countConditions(child), 0);
}

export interface RuleIssue {
  nodeId: string;
  message: string;
}

export function validateTree(root: GroupNode, options: FeatureOption[] = []): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const walk = (node: RuleNode) => {
    if (node.kind === 'group') {
      if (node.children.length === 0)
        issues.push({ nodeId: node.id, message: 'A group needs at least one condition' });
      if (node.children.length > 50) issues.push({ nodeId: node.id, message: 'At most 50 rules per group' });
      node.children.forEach(walk);
      return;
    }
    if (node.feature.includes('<')) {
      issues.push({ nodeId: node.id, message: 'Replace the <placeholder> with a real value' });
      return;
    }
    const value = conditionValue(node, featureKind(node.feature, options));
    const parsed = ruleConditionSchema.safeParse(
      value === undefined
        ? { feature: node.feature.trim(), op: node.op }
        : { feature: node.feature.trim(), op: node.op, value },
    );
    if (!parsed.success)
      issues.push({ nodeId: node.id, message: parsed.error.issues.map((issue) => issue.message).join('; ') });
  };
  walk(root);
  if (treeDepth(root) > MAX_RULE_DEPTH)
    issues.push({ nodeId: root.id, message: `Rules can be nested at most ${MAX_RULE_DEPTH} levels deep` });
  return issues;
}

export function featureOptions(
  known: FeatureOption[],
  categories: string[],
  brands: string[],
  tones: readonly string[],
): FeatureOption[] {
  const out: FeatureOption[] = known.filter((f) => !f.name.includes('<'));
  for (const path of categories)
    out.push({ name: `aff.cat.${path}`, kind: 'number', help: `Affinity to category ${path}` });
  for (const brand of brands)
    out.push({ name: `aff.brand.${brand}`, kind: 'number', help: `Affinity to brand ${brand}` });
  for (const tone of tones)
    out.push({ name: `aff.tone.${tone}`, kind: 'number', help: `Clicks on ${tone} creatives` });
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
}

export function valueHint(feature: string, op: RuleOperator, kind?: FeatureKind): string {
  const mode = valueMode(op);
  if (mode === 'none') return 'optional: false = must be missing';
  if (op === 'within_days') return 'days, e.g. 30';
  if (mode === 'list') return feature === 'price.band' ? 'low, mid' : 'comma separated values';
  if (feature === 'price.band') return 'low | mid | high';
  if (kind === 'boolean') return 'true | false';
  if (feature === 'intent') return '0..1';
  return kind === 'number' ? 'number' : 'value';
}

export function slugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 48);
}
