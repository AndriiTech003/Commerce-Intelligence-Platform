'use client';

import { TONES } from '@cip/contracts';
import { segmentRulesSchema } from '@cip/personalization';
import { Badge, Button, Card, CardTitle, Field, formatNumber, Input, Modal, Spinner } from '@cip/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import {
  featureOptions,
  fromRules,
  newCondition,
  newGroup,
  slugKey,
  toRules,
  validateTree,
  type FeatureKind,
  type FeatureOption,
  type GroupNode,
} from '@/lib/rule-tree';
import { useSession, useTenantId } from '@/lib/session';
import type { Segment } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced';
import { ProblemNote } from './problem-note';
import { RuleBuilder } from './rule-builder';

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const KINDS: FeatureKind[] = ['number', 'string', 'boolean', 'date'];

function initialTree(segment?: Segment): GroupNode {
  if (segment) return fromRules(segment.rules);
  return newGroup('all', [newCondition('intent', 'gte', '0.5')]);
}

export function useFeatureOptions(): { options: FeatureOption[]; loading: boolean } {
  const tenantId = useTenantId();
  const features = useQuery({
    queryKey: queryKeys.segments.features(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/segments/features')),
    staleTime: 300_000,
  });
  const options = useMemo(() => {
    const data = features.data;
    if (!data) return [];
    const known: FeatureOption[] = data.features.map((f) => ({
      name: f.name,
      help: f.help,
      kind: KINDS.includes(f.kind as FeatureKind) ? (f.kind as FeatureKind) : 'string',
    }));
    return featureOptions(known, data.categories, data.brands, TONES);
  }, [features.data]);
  return { options, loading: features.isLoading };
}

export function SegmentEditor({ segment }: { segment?: Segment }) {
  const tenantId = useTenantId();
  const { can } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canWrite = can('marketing:write');
  const rulesLocked = Boolean(segment?.isSystem && segment.key !== 'vip');
  const [name, setName] = useState(segment?.name ?? '');
  const [key, setKey] = useState(segment?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(Boolean(segment));
  const [priority, setPriority] = useState(String(segment?.priority ?? 100));
  const [tree, setTree] = useState<GroupNode>(() => initialTree(segment));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { options } = useFeatureOptions();

  const issues = useMemo(() => validateTree(tree, options), [tree, options]);
  const rules = useMemo(() => toRules(tree, options), [tree, options]);
  const rulesJson = JSON.stringify(rules);
  const schemaOk = issues.length === 0 && segmentRulesSchema.safeParse(rules).success;
  const debounced = useDebouncedValue(schemaOk ? rulesJson : null, 400);

  const preview = useQuery({
    queryKey: queryKeys.segments.preview(tenantId, debounced ?? ''),
    enabled: debounced !== null,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(
        await api.POST('/v1/admin/segments/preview', {
          body: { rules: JSON.parse(debounced!) as Record<string, unknown> },
        }),
      ),
  });

  const effectiveKey = keyTouched ? key : slugKey(name);
  const keyError =
    !segment && effectiveKey.length > 0 && (!KEY_PATTERN.test(effectiveKey) || effectiveKey.length < 2)
      ? 'lowercase letters, digits and underscores, at least 2 characters'
      : null;
  const priorityValue = Number(priority);
  const priorityError =
    !Number.isInteger(priorityValue) || priorityValue < 0 || priorityValue > 10000 ? '0 … 10000' : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!segment) {
        return unwrap(
          await api.POST('/v1/admin/segments', {
            body: { key: effectiveKey, name: name.trim(), rules, priority: priorityValue },
          }),
        );
      }
      return unwrap(
        await api.PATCH('/v1/admin/segments/{id}', {
          params: { path: { id: segment.id } },
          body: {
            name: name.trim(),
            priority: priorityValue,
            ...(rulesLocked ? {} : { rules }),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.segments.all(tenantId) });
      router.push('/marketing/segments');
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!segment) return;
      const result = await api.DELETE('/v1/admin/segments/{id}', { params: { path: { id: segment.id } } });
      if (!result.response.ok) unwrap(result);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.segments.all(tenantId) });
      router.push('/marketing/segments');
    },
  });

  const canSave =
    canWrite &&
    name.trim().length > 0 &&
    effectiveKey.length >= 2 &&
    !keyError &&
    !priorityError &&
    (rulesLocked || schemaOk);
  const share =
    preview.data && preview.data.total > 0 ? (preview.data.count / preview.data.total) * 100 : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardTitle actions={segment?.isSystem ? <Badge tone="blue">system segment</Badge> : null}>
            Details
          </CardTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="segment-name">
              <Input
                id="segment-name"
                value={name}
                disabled={!canWrite}
                onChange={(e) => setName(e.target.value)}
                data-testid="segment-name"
              />
            </Field>
            <Field label="Key" htmlFor="segment-key" error={keyError} hint="Used by campaigns and the API">
              <Input
                id="segment-key"
                value={effectiveKey}
                disabled={Boolean(segment) || !canWrite}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value);
                }}
                className="font-mono"
                data-testid="segment-key"
              />
            </Field>
            <Field
              label="Priority"
              htmlFor="segment-priority"
              error={priorityError}
              hint="Lower wins when a shopper matches several target segments"
            >
              <Input
                id="segment-priority"
                type="number"
                min={0}
                max={10000}
                value={priority}
                disabled={!canWrite}
                onChange={(e) => setPriority(e.target.value)}
                data-testid="segment-priority"
              />
            </Field>
          </div>
        </Card>
        <Card>
          <CardTitle>Rules</CardTitle>
          {rulesLocked ? (
            <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Rules of system segments are fixed. Create a custom segment to target a different audience.
            </p>
          ) : null}
          <RuleBuilder
            value={tree}
            onChange={setTree}
            options={options}
            readOnly={rulesLocked || !canWrite}
            issues={issues}
          />
        </Card>
        <ProblemNote error={save.error ?? remove.error} testId="segment-error" />
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!canSave}
              data-testid="save-segment"
            >
              {segment ? 'Save changes' : 'Create segment'}
            </Button>
            <Link href="/marketing/segments">
              <Button variant="secondary">Cancel</Button>
            </Link>
            {segment && !segment.isSystem ? (
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => setConfirmDelete(true)}
                data-testid="delete-segment"
              >
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div>
        <Card className="sticky top-4">
          <CardTitle actions={preview.isFetching ? <Spinner className="h-4 w-4" /> : null}>
            Live preview
          </CardTitle>
          {!schemaOk && !rulesLocked ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Fix the highlighted rules to see how many profiles match.
            </p>
          ) : null}
          <p
            className="text-3xl font-semibold tabular-nums"
            data-testid="segment-preview-count"
            data-count={preview.data?.count ?? ''}
            aria-live="polite"
          >
            {preview.data ? (
              <>
                ≈ {formatNumber(preview.data.count)}{' '}
                <span className="text-base font-normal text-slate-500 dark:text-slate-400">
                  of {formatNumber(preview.data.total)} profiles
                </span>
              </>
            ) : (
              <span className="text-base font-normal text-slate-500 dark:text-slate-400">—</span>
            )}
          </p>
          {share !== null ? (
            <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-[var(--brand,#2563eb)]"
                style={{ width: `${Math.max(1, share)}%` }}
              />
            </div>
          ) : null}
          {preview.data ? (
            <p
              className="mt-3 font-mono text-xs text-slate-600 dark:text-slate-300"
              data-testid="segment-description"
            >
              {preview.data.description}
            </p>
          ) : null}
          <ProblemNote error={preview.error} />
          {preview.data && preview.data.sample.length > 0 ? (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Sample matches and why
              </h3>
              <ul className="space-y-2" data-testid="segment-preview-sample">
                {preview.data.sample.map((s) => (
                  <li key={s.profileId} className="text-sm">
                    <Link
                      href={s.customerId ? `/customers/${s.customerId}` : `/profiles/${s.profileId}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {s.customerId ? 'customer' : 'visitor'} {s.profileId.slice(0, 8)}
                    </Link>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {s.reasons.map((reason) => (
                        <li
                          key={reason}
                          className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        >
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Counted over the latest profile snapshots (refreshed every 10 minutes), so the number is
            approximate.
          </p>
        </Card>
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete segment?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
              data-testid="confirm-delete-segment"
            >
              Delete
            </Button>
          </>
        }
      >
        <p>
          Campaigns that target <code>{segment?.key}</code> fall back to their other segments or to{' '}
          <code>_default</code>.
        </p>
      </Modal>
    </div>
  );
}
