'use client';

import { PLACEMENTS } from '@cip/contracts';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  cn,
  EmptyState,
  ErrorNote,
  Field,
  formatNumber,
  Input,
  Skeleton,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProblemNote } from '@/components/problem-note';
import {
  describeSelector,
  EMPTY_SELECTOR,
  PLACEMENT_INFO,
  ProductSelectorForm,
  toSelector,
  type SelectorDraft,
} from '@/components/product-selector';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';
import type { Placement } from '@/lib/types';

const STEPS = ['Placement', 'Products', 'Segments', 'Goal & name'] as const;
type Goal = 'click' | 'conversion';

const GOALS: Array<{ value: Goal; label: string; help: string }> = [
  {
    value: 'click',
    label: 'Clicks',
    help: 'Reward a creative when the shopper clicks the block. Fast feedback.',
  },
  {
    value: 'conversion',
    label: 'Conversions',
    help: 'Reward only when an order is attributed to the decision within 24 h. Slower, closer to revenue.',
  },
];

function Choice({
  name,
  value,
  checked,
  onSelect,
  title,
  help,
  testId,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  help: string;
  testId: string;
}) {
  return (
    <label
      data-testid={testId}
      className={cn(
        'flex cursor-pointer gap-3 rounded-lg border p-4',
        checked
          ? 'border-[var(--brand,#2563eb)] bg-blue-50/50 dark:bg-blue-950/30'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800',
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="mt-1" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{help}</span>
      </span>
    </label>
  );
}

function SegmentsStep({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const tenantId = useTenantId();
  const segments = useQuery({
    queryKey: queryKeys.segments.list(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/segments')),
  });
  const rows = [...(segments.data?.data ?? [])].sort((a, b) => a.priority - b.priority);
  if (segments.error) return <ErrorNote error={segments.error} />;
  if (segments.isLoading) return <Skeleton className="h-48" />;
  if (rows.length === 0)
    return (
      <EmptyState
        title="No segments"
        description="Without target segments every shopper lands in _default."
        action={
          <Link href="/marketing/segments/new">
            <Button variant="secondary">Create a segment</Button>
          </Link>
        }
      />
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        A shopper feeds the bandit of the matching target segment with the lowest priority; everyone else
        falls into <code>_default</code>. Each segment learns its own best creative.
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {rows.map((s) => {
          const checked = selected.includes(s.key);
          return (
            <li key={s.id}>
              <label
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border p-3',
                  checked
                    ? 'border-[var(--brand,#2563eb)] bg-blue-50/50 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(checked ? selected.filter((k) => k !== s.key) : [...selected, s.key])
                  }
                  data-testid={`segment-option-${s.key}`}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {s.name}
                    <code className="text-xs text-slate-500 dark:text-slate-400">{s.key}</code>
                    <Badge>p{s.priority}</Badge>
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                      ≈ {formatNumber(s.members)} profiles
                    </span>
                  </span>
                  <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {s.description}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function NewCampaignPage() {
  const tenantId = useTenantId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [placement, setPlacement] = useState<Placement>('home_hero');
  const [selector, setSelector] = useState<SelectorDraft>(EMPTY_SELECTOR);
  const [segments, setSegments] = useState<string[]>([]);
  const [goal, setGoal] = useState<Goal>('click');
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/campaigns', {
          body: {
            name: name.trim(),
            placement,
            targetSegments: segments,
            productSelector: toSelector(selector),
            goal,
          },
        }),
      ),
    onSuccess: (campaign) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all(tenantId) });
      router.push(`/marketing/campaigns/${campaign.id}`);
    },
  });

  const last = step === STEPS.length - 1;
  return (
    <div>
      <PageHeader
        title="New campaign"
        description="Four steps. Creatives are generated after the campaign exists."
      />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Wizard steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
              aria-current={index === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
                index === step
                  ? 'border-[var(--brand,#2563eb)] bg-[var(--brand,#2563eb)] text-white'
                  : index < step
                    ? 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                    : 'border-slate-200 text-slate-500 dark:text-slate-400 dark:border-slate-800',
              )}
            >
              <span className="tabular-nums">{index + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>
      <Card>
        <CardTitle>{STEPS[step]}</CardTitle>
        {step === 0 ? (
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Placement">
            {PLACEMENTS.map((p) => (
              <Choice
                key={p}
                name="placement"
                value={p}
                checked={placement === p}
                onSelect={() => setPlacement(p)}
                title={PLACEMENT_INFO[p].label}
                help={PLACEMENT_INFO[p].help}
                testId={`placement-${p}`}
              />
            ))}
          </div>
        ) : null}
        {step === 1 ? <ProductSelectorForm value={selector} onChange={setSelector} /> : null}
        {step === 2 ? <SegmentsStep selected={segments} onChange={setSegments} /> : null}
        {step === 3 ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Goal">
              {GOALS.map((g) => (
                <Choice
                  key={g.value}
                  name="goal"
                  value={g.value}
                  checked={goal === g.value}
                  onSelect={() => setGoal(g.value)}
                  title={g.label}
                  help={g.help}
                  testId={`goal-${g.value}`}
                />
              ))}
            </div>
            <Field label="Campaign name" htmlFor="campaign-name">
              <Input
                id="campaign-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Autumn trail push"
                data-testid="campaign-name"
              />
            </Field>
            <dl className="grid gap-1 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500 dark:text-slate-400">Placement</dt>
                <dd>{PLACEMENT_INFO[placement].label}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500 dark:text-slate-400">Products</dt>
                <dd>{describeSelector(toSelector(selector))}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500 dark:text-slate-400">Segments</dt>
                <dd>{segments.length > 0 ? segments.join(', ') : 'everyone (_default)'}</dd>
              </div>
            </dl>
            <ProblemNote error={create.error} testId="campaign-error" />
          </div>
        ) : null}
        <div className="mt-6 flex justify-between gap-2">
          <Button
            variant="secondary"
            onClick={() => (step === 0 ? router.push('/marketing/campaigns') : setStep(step - 1))}
            data-testid="wizard-back"
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {last ? (
            <Button
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={name.trim().length === 0}
              data-testid="campaign-create"
            >
              Create campaign
            </Button>
          ) : (
            <Button onClick={() => setStep(step + 1)} data-testid="wizard-next">
              Next
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
