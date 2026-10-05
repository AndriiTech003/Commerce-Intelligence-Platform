'use client';

import {
  Badge,
  Button,
  CampaignBlock,
  Card,
  CardTitle,
  cn,
  EmptyState,
  ErrorNote,
  Field,
  formatDateTime,
  Input,
  Select,
  Skeleton,
  statusTone,
  Textarea,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CreativeCard } from '@/components/creative-card';
import { ExperimentView } from '@/components/experiment-view';
import { ProblemNote } from '@/components/problem-note';
import { describeSelector, PLACEMENT_INFO, usePreviewProducts } from '@/components/product-selector';
import { SectionBoundary } from '@/components/section-boundary';
import { PageHeader } from '@/components/shell';
import { api, errorCode, unwrap } from '@/lib/api';
import {
  ALL_TONES,
  CREATIVE_LIMITS,
  patchCampaignCreatives,
  type OptimisticApply,
  type ToneValue,
} from '@/lib/creatives';
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';
import type { CampaignDetail, Creative } from '@/lib/types';
import { isJobDone, jobProgress, useJob } from '@/lib/use-job';

type CampaignStatus = CampaignDetail['status'];

const STATUS_FILTERS = ['all', 'draft', 'approved', 'active', 'paused', 'rejected'] as const;

function AiFeatures() {
  const tenantId = useTenantId();
  const features = useQuery({
    queryKey: queryKeys.aiFeatures(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/features')),
  });
  const f = features.data;
  if (!f) return features.error ? <ErrorNote error={features.error} /> : <Skeleton className="h-10" />;
  const usage = f.llm.dailyLimit > 0 ? Math.min(100, (f.llm.usedToday / f.llm.dailyLimit) * 100) : 0;
  return (
    <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300" data-testid="ai-features">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={f.aiCreatives ? 'green' : 'red'}>ai-creatives {f.aiCreatives ? 'on' : 'off'}</Badge>
        <span>
          flag source <code>{f.flags.source}</code>
          {f.flags.relay ? (
            <>
              {' '}
              via <code>{f.flags.relay}</code>
            </>
          ) : null}
        </span>
        <span>
          LLM <code>{`${f.llm.provider}:${f.llm.model}`}</code>
        </span>
      </p>
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap" data-testid="llm-usage">
          {f.llm.usedToday} / {f.llm.dailyLimit} generations today
        </span>
        <span className="h-1.5 flex-1 rounded bg-slate-100 dark:bg-slate-800" aria-hidden="true">
          <span
            className={cn('block h-1.5 rounded', usage >= 90 ? 'bg-red-500' : 'bg-emerald-500')}
            style={{ width: `${usage}%` }}
          />
        </span>
      </div>
    </div>
  );
}

function GeneratePanel({ campaign }: { campaign: CampaignDetail }) {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const segmentOptions = useMemo(() => [...campaign.targetSegments, '_default'], [campaign.targetSegments]);
  const [segments, setSegments] = useState<string[]>(() => [segmentOptions[0]!]);
  const [tones, setTones] = useState<ToneValue[]>(['performance', 'value']);
  const [count, setCount] = useState('2');
  const [jobId, setJobId] = useState<string | null>(null);
  const [blockedByFlag, setBlockedByFlag] = useState(false);
  const features = useQuery({
    queryKey: queryKeys.aiFeatures(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/features')),
  });
  const job = useJob(jobId);
  const campaignId = campaign.id;
  const processed = job.data?.processed;
  const jobStatus = job.data?.status;

  useEffect(() => {
    if (processed === undefined) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(tenantId, campaignId) });
    if (jobStatus === 'completed' || jobStatus === 'failed') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.aiFeatures(tenantId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.creatives.reviewQueue(tenantId) });
    }
  }, [processed, jobStatus, queryClient, campaignId, tenantId]);

  const generate = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/campaigns/{id}/creatives/generate', {
          params: { path: { id: campaign.id } },
          body: { segments, tones, count: Number(count), async: true },
        }),
      ),
    onSuccess: (result) => {
      setBlockedByFlag(false);
      setJobId(result.jobId);
    },
    onError: (error) => {
      if (errorCode(error) === 'FEATURE_DISABLED') {
        setBlockedByFlag(true);
        void queryClient.invalidateQueries({ queryKey: queryKeys.aiFeatures(tenantId) });
      }
    },
  });

  const disabled = blockedByFlag || features.data?.aiCreatives === false;
  const running = jobId !== null && !isJobDone(job.data);
  const countValue = Number(count);
  const valid =
    segments.length > 0 &&
    tones.length > 0 &&
    Number.isInteger(countValue) &&
    countValue >= 1 &&
    countValue <= 5;
  const result = job.data?.result;
  const rejected = typeof result?.rejected === 'number' ? result.rejected : 0;
  const created = Array.isArray(result?.creativeIds) ? result.creativeIds.length : 0;
  const failure = typeof result?.error === 'string' ? result.error : null;

  return (
    <Card id="generate" data-testid="generate-panel">
      <CardTitle>Generate creatives with the LLM</CardTitle>
      <AiFeatures />
      {disabled ? (
        <div
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          data-testid="ai-disabled"
          role="status"
        >
          AI creative generation is turned off by the <code>ai-creatives</code> feature flag
          {features.data ? ` (source: ${features.data.flags.source})` : ''}. Write creatives manually below,
          or enable the flag.
        </div>
      ) : null}
      <div
        className={cn('mt-4 space-y-4', disabled && 'pointer-events-none opacity-50')}
        aria-disabled={disabled}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Segments</legend>
          <div className="flex flex-wrap gap-2">
            {segmentOptions.map((key) => (
              <label
                key={key}
                className="flex items-center gap-1.5 rounded-full border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={segments.includes(key)}
                  disabled={disabled}
                  onChange={(e) =>
                    setSegments((s) => (e.target.checked ? [...s, key] : s.filter((k) => k !== key)))
                  }
                  data-testid={`generate-segment-${key}`}
                />
                <code>{key}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Tones</legend>
          <div className="flex flex-wrap gap-2">
            {ALL_TONES.map((tone) => (
              <label
                key={tone}
                className="flex items-center gap-1.5 rounded-full border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={tones.includes(tone)}
                  disabled={disabled}
                  onChange={(e) =>
                    setTones((t) => (e.target.checked ? [...t, tone] : t.filter((x) => x !== tone)))
                  }
                  data-testid={`generate-tone-${tone}`}
                />
                {tone}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Variants per segment" htmlFor="generate-count">
            <div className="w-24 shrink-0">
              <Input
                id="generate-count"
                type="number"
                min={1}
                max={5}
                value={count}
                disabled={disabled}
                onChange={(e) => setCount(e.target.value)}
                data-testid="generate-count"
              />
            </div>
          </Field>
          <Button
            onClick={() => generate.mutate()}
            loading={generate.isPending || running}
            disabled={disabled || !valid}
            data-testid="generate-creatives"
          >
            {running ? 'Generating…' : 'Generate'}
          </Button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Only aggregates go into the prompt (no PII). Every variant passes deterministic guardrails and lands
          as a draft for review.
        </p>
      </div>
      {!blockedByFlag ? <ProblemNote error={generate.error} testId="generate-error" /> : null}
      {jobId ? (
        <div
          className="mt-4 space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800"
          data-testid="generate-job"
          data-status={job.data?.status ?? 'queued'}
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              Job <code className="text-xs">{jobId.slice(0, 8)}</code>
            </span>
            <Badge
              tone={statusTone(
                job.data?.status === 'completed' ? 'succeeded' : (job.data?.status ?? 'processing'),
              )}
            >
              {job.data?.status ?? 'queued'}
            </Badge>
          </div>
          <div
            role="progressbar"
            aria-label="Generation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={jobProgress(job.data)}
            className="h-2 rounded bg-slate-100 dark:bg-slate-800"
          >
            <div
              className="h-2 rounded bg-[var(--brand,#2563eb)] transition-all"
              style={{ width: `${jobProgress(job.data)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {job.data ? `${job.data.processed} of ${job.data.total} segments processed` : 'Starting…'}
            {created > 0 ? ` · ${created} drafts created` : ''}
            {rejected > 0 ? ` · ${rejected} variants rejected by guardrails` : ''}
          </p>
          {failure ? <ErrorNote error={new Error(failure)} /> : null}
          {job.data && job.data.errors.length > 0 ? (
            <ul className="list-inside list-disc text-xs text-red-700 dark:text-red-300">
              {job.data.errors.map((e) => (
                <li key={`${e.row}-${e.message}`}>{e.message}</li>
              ))}
            </ul>
          ) : null}
          <ErrorNote error={job.error} />
        </div>
      ) : null}
    </Card>
  );
}

function ManualCreativeForm({ campaign, onCreated }: { campaign: CampaignDetail; onCreated: () => void }) {
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [cta, setCta] = useState('');
  const [tone, setTone] = useState<ToneValue | ''>('');
  const [segment, setSegment] = useState('');
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/campaigns/{id}/creatives', {
          params: { path: { id: campaign.id } },
          body: {
            headline: headline.trim(),
            body: body.trim(),
            cta: cta.trim(),
            tone: tone || null,
            targetSegment: segment || null,
          },
        }),
      ),
    onSuccess: () => {
      setHeadline('');
      setBody('');
      setCta('');
      onCreated();
    },
  });
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <summary className="cursor-pointer text-sm font-semibold">Write a creative manually</summary>
      <form
        className="mt-3 grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Field label={`Headline (≤ ${CREATIVE_LIMITS.headline})`} htmlFor="manual-headline">
          <Input
            id="manual-headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            data-testid="manual-headline"
          />
        </Field>
        <Field label={`CTA (≤ ${CREATIVE_LIMITS.cta})`} htmlFor="manual-cta">
          <Input
            id="manual-cta"
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            data-testid="manual-cta"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label={`Body (≤ ${CREATIVE_LIMITS.body})`} htmlFor="manual-body">
            <Textarea
              id="manual-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[72px]"
              data-testid="manual-body"
            />
          </Field>
        </div>
        <Field label="Tone" htmlFor="manual-tone">
          <Select id="manual-tone" value={tone} onChange={(e) => setTone(e.target.value as ToneValue | '')}>
            <option value="">none</option>
            {ALL_TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Target segment" htmlFor="manual-segment">
          <Select id="manual-segment" value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="">all segments</option>
            {campaign.targetSegments.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2 md:col-span-2">
          <ProblemNote error={create.error} testId="manual-error" />
          <Button
            type="submit"
            loading={create.isPending}
            disabled={!headline.trim() || !body.trim() || !cta.trim()}
            data-testid="manual-create"
          >
            Add draft
          </Button>
        </div>
      </form>
    </details>
  );
}

function CreativesSection({ campaign }: { campaign: CampaignDetail }) {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const products = usePreviewProducts(campaign.productSelector, 4);
  const detailKey = queryKeys.campaigns.detail(tenantId, campaign.id);
  const optimistic: OptimisticApply = (creativeId, change) => {
    void queryClient.cancelQueries({ queryKey: detailKey });
    const previous = queryClient.getQueryData<CampaignDetail>(detailKey);
    queryClient.setQueryData<CampaignDetail>(detailKey, (old) =>
      patchCampaignCreatives(old, creativeId, change),
    );
    return () => queryClient.setQueryData(detailKey, previous);
  };
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: detailKey });
    void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.experiment(tenantId, campaign.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.creatives.reviewQueue(tenantId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.list(tenantId) });
  };
  const creatives = campaign.creatives.filter((c) => filter === 'all' || c.status === filter);
  const previewCreative: Creative | undefined =
    campaign.creatives.find((c) => c.id === previewId) ??
    campaign.creatives.find((c) => c.status === 'active') ??
    campaign.creatives[0];
  const counts = campaign.creatives.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <section id="creatives" className="space-y-4" aria-labelledby="creatives-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="creatives-title" className="text-lg font-semibold">
          Creatives
        </h2>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter creatives by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-3 py-1 text-xs',
                filter === f
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200',
              )}
            >
              {f} {f === 'all' ? campaign.creatives.length : (counts[f] ?? 0)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {creatives.length === 0 ? (
            <EmptyState
              title={campaign.creatives.length === 0 ? 'No creatives yet' : `No ${filter} creatives`}
              description={
                campaign.creatives.length === 0
                  ? 'Generate variants with the LLM or write one by hand. They start as drafts.'
                  : undefined
              }
              action={
                campaign.creatives.length === 0 ? (
                  <a href="#generate">
                    <Button variant="secondary">Generate creatives</Button>
                  </a>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2" data-testid="creative-list">
              {creatives.map((creative) => (
                <CreativeCard
                  key={`${creative.id}-${creative.headline}`}
                  creative={creative}
                  optimistic={optimistic}
                  onSettled={settle}
                  selected={previewCreative?.id === creative.id}
                  onPreview={() => setPreviewId(creative.id)}
                />
              ))}
            </div>
          )}
          <ManualCreativeForm campaign={campaign} onCreated={settle} />
        </div>
        <div>
          <Card className="sticky top-4" data-testid="creative-preview">
            <CardTitle>
              Storefront preview{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                · {PLACEMENT_INFO[campaign.placement].label}
              </span>
            </CardTitle>
            {previewCreative ? (
              <CampaignBlock
                placement={campaign.placement}
                creative={previewCreative}
                products={products.data?.products ?? []}
                preview
                badge={<Badge tone={statusTone(previewCreative.status)}>{previewCreative.status}</Badge>}
              />
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Add a creative to see the block as shoppers will.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Rendered with the shared storefront component and the first products of the campaign selector.
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const detailKey = queryKeys.campaigns.detail(tenantId, id);
  const campaign = useQuery({
    queryKey: detailKey,
    queryFn: async () => unwrap(await api.GET('/v1/admin/campaigns/{id}', { params: { path: { id } } })),
  });
  const setStatus = useMutation({
    mutationFn: async (status: CampaignStatus) =>
      unwrap(await api.PATCH('/v1/admin/campaigns/{id}', { params: { path: { id } }, body: { status } })),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<CampaignDetail>(detailKey);
      queryClient.setQueryData<CampaignDetail>(detailKey, (old) => (old ? { ...old, status } : old));
      return { previous };
    },
    onError: (_error, _status, context) => queryClient.setQueryData(detailKey, context?.previous),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all(tenantId) });
    },
  });

  if (campaign.error) return <ErrorNote error={campaign.error} />;
  const c = campaign.data;
  if (!c) return <Skeleton className="h-96" />;
  const canWrite = can('marketing:write');
  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={`${PLACEMENT_INFO[c.placement].label} · goal: ${c.goal} · created ${formatDateTime(c.createdAt)}`}
        actions={
          canWrite ? (
            <>
              <Badge tone={statusTone(c.status)} className="self-center">
                <span data-testid="campaign-status">{c.status}</span>
              </Badge>
              {c.status === 'draft' || c.status === 'paused' ? (
                <Button
                  onClick={() => setStatus.mutate('active')}
                  disabled={setStatus.isPending}
                  data-testid="activate-campaign"
                >
                  Activate
                </Button>
              ) : null}
              {c.status === 'active' ? (
                <Button
                  variant="secondary"
                  onClick={() => setStatus.mutate('paused')}
                  disabled={setStatus.isPending}
                  data-testid="pause-campaign"
                >
                  Pause
                </Button>
              ) : null}
              {c.status !== 'ended' ? (
                <Button
                  variant="ghost"
                  onClick={() => setStatus.mutate('ended')}
                  disabled={setStatus.isPending}
                  data-testid="end-campaign"
                >
                  End
                </Button>
              ) : null}
            </>
          ) : (
            <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          )
        }
      />
      <ProblemNote error={setStatus.error} />
      <Card>
        <dl className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Target segments
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {c.targetSegments.length > 0
                ? c.targetSegments.map((s) => (
                    <code key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                      {s}
                    </code>
                  ))
                : null}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:text-slate-400 dark:bg-slate-800">
                _default
              </code>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Products</dt>
            <dd className="mt-1">{describeSelector(c.productSelector)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Jump to</dt>
            <dd className="mt-1 flex gap-3">
              <a href="#creatives" className="text-[var(--brand,#2563eb)] hover:underline dark:text-blue-400">
                Creatives
              </a>
              <a href="#generate" className="text-[var(--brand,#2563eb)] hover:underline dark:text-blue-400">
                Generate
              </a>
              <a
                href="#experiment"
                className="text-[var(--brand,#2563eb)] hover:underline dark:text-blue-400"
              >
                Experiment
              </a>
            </dd>
          </div>
        </dl>
        {c.status === 'draft' ? (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Draft campaigns are not served. Approve at least one creative, then activate.
          </p>
        ) : null}
      </Card>
      <SectionBoundary title="Creatives">
        <CreativesSection campaign={c} />
      </SectionBoundary>
      {canWrite ? (
        <SectionBoundary title="Generate">
          <GeneratePanel campaign={c} />
        </SectionBoundary>
      ) : null}
      <section id="experiment" aria-labelledby="experiment-title" className="space-y-3">
        <h2 id="experiment-title" className="text-lg font-semibold">
          Experiment
        </h2>
        <SectionBoundary title="Experiment">
          <ExperimentView campaignId={c.id} />
        </SectionBoundary>
      </section>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <Link href="/marketing/campaigns" className="hover:underline">
          ← All campaigns
        </Link>
      </p>
    </div>
  );
}
