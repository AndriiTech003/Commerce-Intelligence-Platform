'use client';

import { Button, cn, Input, Select } from '@cip/ui';
import type { RuleOperator } from '@cip/personalization';
import { useId } from 'react';
import {
  addChild,
  featureKind,
  MAX_RULE_DEPTH,
  newCondition,
  newGroup,
  nodeDepth,
  OPERATOR_LABELS,
  OPERATORS,
  removeNode,
  setGroupMode,
  updateCondition,
  valueHint,
  valueMode,
  type ConditionNode,
  type FeatureOption,
  type GroupMode,
  type GroupNode,
  type RuleIssue,
} from '@/lib/rule-tree';

interface BuilderContext {
  root: GroupNode;
  onChange: (root: GroupNode) => void;
  options: FeatureOption[];
  readOnly: boolean;
  issues: Map<string, string>;
  listId: string;
}

function ConditionRow({ node, ctx }: { node: ConditionNode; ctx: BuilderContext }) {
  const kind = featureKind(node.feature, ctx.options);
  const mode = valueMode(node.op);
  const help = ctx.options.find((o) => o.name === node.feature)?.help;
  const issue = ctx.issues.get(node.id);
  return (
    <li data-testid="rule-condition" className="space-y-1">
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_11rem_auto]">
        <div className="min-w-0">
          <Input
            aria-label="Feature"
            list={ctx.listId}
            value={node.feature}
            disabled={ctx.readOnly}
            placeholder="feature, e.g. aff.cat.running"
            onChange={(e) => ctx.onChange(updateCondition(ctx.root, node.id, { feature: e.target.value }))}
            className="font-mono text-xs"
            data-testid="rule-feature"
          />
          {help ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{help}</p> : null}
        </div>
        <Select
          aria-label="Operator"
          value={node.op}
          disabled={ctx.readOnly}
          onChange={(e) =>
            ctx.onChange(updateCondition(ctx.root, node.id, { op: e.target.value as RuleOperator }))
          }
          data-testid="rule-operator"
        >
          {OPERATORS.map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </Select>
        {mode === 'none' ? (
          <Select
            aria-label="Must exist"
            value={node.value === 'false' ? 'false' : ''}
            disabled={ctx.readOnly}
            onChange={(e) => ctx.onChange(updateCondition(ctx.root, node.id, { value: e.target.value }))}
            data-testid="rule-value"
          >
            <option value="">is present</option>
            <option value="false">is missing</option>
          </Select>
        ) : (
          <Input
            aria-label="Value"
            type={mode === 'number' ? 'number' : 'text'}
            step="any"
            value={node.value}
            disabled={ctx.readOnly}
            placeholder={valueHint(node.feature, node.op, kind)}
            onChange={(e) => ctx.onChange(updateCondition(ctx.root, node.id, { value: e.target.value }))}
            data-testid="rule-value"
          />
        )}
        {!ctx.readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Remove condition"
            onClick={() => ctx.onChange(removeNode(ctx.root, node.id))}
            className="mt-1"
          >
            ✕
          </Button>
        ) : null}
      </div>
      {issue ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {issue}
        </p>
      ) : null}
    </li>
  );
}

function GroupBox({ node, ctx, isRoot }: { node: GroupNode; ctx: BuilderContext; isRoot: boolean }) {
  const depth = nodeDepth(ctx.root, node.id);
  const issue = ctx.issues.get(node.id);
  return (
    <div
      data-testid="rule-group"
      className={cn(
        'space-y-3 rounded-lg border p-3',
        node.mode === 'all'
          ? 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20'
          : 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600 dark:text-slate-300">Match</span>
        <div className="w-28">
          <Select
            aria-label="Group mode"
            value={node.mode}
            disabled={ctx.readOnly}
            onChange={(e) => ctx.onChange(setGroupMode(ctx.root, node.id, e.target.value as GroupMode))}
            data-testid="rule-group-mode"
          >
            <option value="all">ALL</option>
            <option value="any">ANY</option>
          </Select>
        </div>
        <span className="text-slate-600 dark:text-slate-300">of the following</span>
        {!isRoot && !ctx.readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => ctx.onChange(removeNode(ctx.root, node.id))}
          >
            Remove group
          </Button>
        ) : null}
      </div>
      <ul className="space-y-3">
        {node.children.map((child) =>
          child.kind === 'group' ? (
            <li key={child.id}>
              <GroupBox node={child} ctx={ctx} isRoot={false} />
            </li>
          ) : (
            <ConditionRow key={child.id} node={child} ctx={ctx} />
          ),
        )}
      </ul>
      {issue ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {issue}
        </p>
      ) : null}
      {!ctx.readOnly ? (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => ctx.onChange(addChild(ctx.root, node.id, newCondition()))}
            data-testid="rule-add-condition"
          >
            + Condition
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={depth >= MAX_RULE_DEPTH}
            onClick={() =>
              ctx.onChange(addChild(ctx.root, node.id, newGroup(node.mode === 'all' ? 'any' : 'all')))
            }
            data-testid="rule-add-group"
          >
            + Group
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function RuleBuilder({
  value,
  onChange,
  options,
  readOnly = false,
  issues = [],
}: {
  value: GroupNode;
  onChange: (root: GroupNode) => void;
  options: FeatureOption[];
  readOnly?: boolean;
  issues?: RuleIssue[];
}) {
  const listId = `features-${useId().replace(/:/g, '')}`;
  const ctx: BuilderContext = {
    root: value,
    onChange,
    options,
    readOnly,
    issues: new Map(issues.map((issue) => [issue.nodeId, issue.message])),
    listId,
  };
  return (
    <div data-testid="rule-builder">
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.name} value={option.name}>
            {option.help}
          </option>
        ))}
      </datalist>
      <GroupBox node={value} ctx={ctx} isRoot />
    </div>
  );
}
