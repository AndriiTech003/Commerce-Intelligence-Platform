'use client';

import { Badge, Button, Card, cn, Field, formatDateTime, Input, Select, Textarea } from '@cip/ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api';
import {
  ALL_TONES,
  blockingFlags,
  CREATIVE_LIMITS,
  FLAG_HELP,
  isTone,
  type CreativeChange,
  type OptimisticApply,
  type ToneValue,
} from '@/lib/creatives';
import { useSession } from '@/lib/session';
import type { Creative } from '@/lib/types';
import { ProblemNote } from './problem-note';

const STATUS_TONE = {
  draft: 'yellow',
  approved: 'blue',
  active: 'green',
  paused: 'neutral',
  rejected: 'red',
} as const;

function Counter({ value, limit }: { value: string; limit: number }) {
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        value.length > limit ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400',
      )}
    >
      {value.length}/{limit}
    </span>
  );
}

function GenerationMeta({ creative }: { creative: Creative }) {
  const g = creative.generation;
  if (!g || creative.source !== 'llm') return null;
  const items: Array<[string, ReactNode]> = [];
  if (g.model) items.push(['Model', `${g.provider ? `${g.provider}:` : ''}${g.model}`]);
  if (g.promptVersion) items.push(['Prompt', g.promptVersion]);
  if (g.tokens) items.push(['Tokens', `${g.tokens.input} in / ${g.tokens.output} out`]);
  if (g.latencyMs !== undefined) items.push(['Latency', `${Math.round(g.latencyMs)} ms`]);
  if (g.costUsd !== undefined) items.push(['Cost', `$${g.costUsd.toFixed(4)}`]);
  if (g.attempts !== undefined && g.attempts > 1) items.push(['Attempts', String(g.attempts)]);
  if (g.cached !== undefined) items.push(['Cache', g.cached ? 'hit' : 'miss']);
  return (
    <dl
      className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400"
      data-testid="creative-meta"
    >
      {items.map(([label, value]) => (
        <div key={label} className="flex gap-1 whitespace-nowrap">
          <dt>{label}:</dt>
          <dd className="font-mono text-slate-700 dark:text-slate-300">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CreativeCard({
  creative,
  optimistic,
  onSettled,
  removeOnReview = false,
  campaign,
  selected,
  onPreview,
  onError,
}: {
  creative: Creative;
  optimistic: OptimisticApply;
  onSettled: () => void;
  removeOnReview?: boolean;
  campaign?: { id: string; name: string; placement: string };
  selected?: boolean;
  onPreview?: () => void;
  onError?: (error: unknown) => void;
}) {
  const { can } = useSession();
  const canApprove = can('marketing:approve');
  const canWrite = can('marketing:write');
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(creative.headline);
  const [body, setBody] = useState(creative.body);
  const [cta, setCta] = useState(creative.cta);
  const [tone, setTone] = useState<ToneValue | ''>(isTone(creative.tone) ? creative.tone : '');
  const [comment, setComment] = useState('');
  const flags = creative.guardrailFlags;
  const blocking = blockingFlags(flags);
  const details = creative.generation?.flagDetails ?? [];

  const withOptimism = (change: CreativeChange) => ({ rollback: optimistic(creative.id, change) });

  const review = useMutation({
    mutationFn: async (decision: 'approve' | 'reject') =>
      unwrap(
        await api.POST('/v1/admin/creatives/{id}/review', {
          params: { path: { id: creative.id } },
          body: comment.trim() ? { decision, comment: comment.trim() } : { decision },
        }),
      ),
    onMutate: (decision) =>
      withOptimism((c) =>
        removeOnReview
          ? null
          : {
              ...c,
              status: decision === 'approve' ? 'approved' : 'rejected',
              reviewComment: comment.trim() || null,
            },
      ),
    onError: (error, _decision, context) => {
      context?.rollback();
      onError?.(error);
    },
    onSettled,
  });

  const status = useMutation({
    mutationFn: async (next: 'active' | 'paused') =>
      unwrap(
        await api.PATCH('/v1/admin/creatives/{id}', {
          params: { path: { id: creative.id } },
          body: { status: next },
        }),
      ),
    onMutate: (next) => withOptimism((c) => ({ ...c, status: next })),
    onError: (error, _next, context) => {
      context?.rollback();
      onError?.(error);
    },
    onSettled,
  });

  const edit = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/v1/admin/creatives/{id}', {
          params: { path: { id: creative.id } },
          body: { headline: headline.trim(), body: body.trim(), cta: cta.trim(), tone: tone || null },
        }),
      ),
    onSuccess: () => {
      setEditing(false);
      onSettled();
    },
  });

  const startEdit = () => {
    setHeadline(creative.headline);
    setBody(creative.body);
    setCta(creative.cta);
    setTone(isTone(creative.tone) ? creative.tone : '');
    edit.reset();
    setEditing(true);
  };

  const isDraft = creative.status === 'draft';
  const reviewError = review.error ?? status.error;

  return (
    <Card
      data-testid="creative-card"
      data-status={creative.status}
      data-creative-id={creative.id}
      className={cn('flex flex-col gap-3', selected && 'ring-2 ring-[var(--brand,#2563eb)]')}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[creative.status]}>{creative.status}</Badge>
        {creative.tone ? <Badge tone="blue">{creative.tone}</Badge> : <Badge>no tone</Badge>}
        <Badge>{creative.source === 'llm' ? 'LLM' : 'human'}</Badge>
        {creative.targetSegment ? (
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
            {creative.targetSegment}
          </code>
        ) : null}
        {onPreview ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onPreview} aria-pressed={selected}>
            Preview
          </Button>
        ) : null}
      </div>
      {campaign ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <Link href={`/marketing/campaigns/${campaign.id}`} className="font-medium hover:underline">
            {campaign.name}
          </Link>{' '}
          · {campaign.placement.replace(/_/g, ' ')}
        </p>
      ) : null}
      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            edit.mutate();
          }}
        >
          <Field label="Headline" htmlFor={`headline-${creative.id}`}>
            <Input
              id={`headline-${creative.id}`}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              data-testid="creative-headline-input"
            />
            <Counter value={headline} limit={CREATIVE_LIMITS.headline} />
          </Field>
          <Field label="Body" htmlFor={`body-${creative.id}`}>
            <Textarea
              id={`body-${creative.id}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[72px]"
              data-testid="creative-body-input"
            />
            <Counter value={body} limit={CREATIVE_LIMITS.body} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="CTA" htmlFor={`cta-${creative.id}`}>
              <Input
                id={`cta-${creative.id}`}
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                data-testid="creative-cta-input"
              />
              <Counter value={cta} limit={CREATIVE_LIMITS.cta} />
            </Field>
            <Field label="Tone" htmlFor={`tone-${creative.id}`}>
              <Select
                id={`tone-${creative.id}`}
                value={tone}
                onChange={(e) => setTone(e.target.value as ToneValue | '')}
              >
                <option value="">none</option>
                {ALL_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Saving re-runs the guardrails on the new text.
          </p>
          <ProblemNote error={edit.error} testId="creative-edit-error" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={edit.isPending} data-testid="save-creative">
              Save
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <h3 className="text-base font-semibold leading-snug" data-testid="creative-headline">
            {creative.headline}
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{creative.body}</p>
          <span className="mt-2 inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
            {creative.cta}
          </span>
        </div>
      )}
      {flags.length > 0 ? (
        <div className="space-y-1">
          <ul className="flex flex-wrap gap-1" aria-label="Guardrail flags">
            {flags.map((flag) => (
              <li key={flag} title={FLAG_HELP[flag] ?? flag}>
                <Badge tone={blocking.includes(flag) ? 'red' : 'yellow'}>
                  <span data-testid="guardrail-flag" data-flag={flag}>
                    ⚠ {flag}
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
          {details.length > 0 ? (
            <ul className="list-inside list-disc text-xs text-amber-800 dark:text-amber-300">
              {details.map((detail, index) => (
                <li key={index}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {creative.generation?.rationale ? (
        <blockquote className="border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <span className="not-italic font-medium">LLM rationale: </span>
          {creative.generation.rationale}
        </blockquote>
      ) : null}
      <GenerationMeta creative={creative} />
      {creative.reviewedAt ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Reviewed {formatDateTime(creative.reviewedAt)}
          {creative.reviewComment ? ` · “${creative.reviewComment}”` : ''}
        </p>
      ) : null}
      {!editing ? (
        <div className="mt-auto space-y-2">
          {isDraft && canApprove ? (
            <Input
              aria-label="Review comment"
              placeholder="Review comment (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="text-xs"
              data-testid="review-comment"
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {isDraft && canWrite ? (
              <Button size="sm" variant="secondary" onClick={startEdit} data-testid="edit-creative">
                Edit
              </Button>
            ) : null}
            {isDraft && canApprove ? (
              <>
                <Button
                  size="sm"
                  onClick={() => review.mutate('approve')}
                  disabled={blocking.length > 0 || review.isPending}
                  title={blocking.length > 0 ? `Fix ${blocking.join(', ')} before approving` : undefined}
                  data-testid="approve-creative"
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => review.mutate('reject')}
                  disabled={review.isPending}
                  data-testid="reject-creative"
                >
                  Reject
                </Button>
              </>
            ) : null}
            {canWrite && creative.status === 'active' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => status.mutate('paused')}
                disabled={status.isPending}
                data-testid="pause-creative"
              >
                Pause
              </Button>
            ) : null}
            {canWrite && (creative.status === 'approved' || creative.status === 'paused') ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => status.mutate('active')}
                disabled={status.isPending}
                data-testid="activate-creative"
              >
                Activate
              </Button>
            ) : null}
          </div>
          {isDraft && canApprove && blocking.length > 0 ? (
            <p className="text-xs text-red-700 dark:text-red-300" data-testid="approval-blocked">
              Approval is blocked by {blocking.join(', ')}. Edit the text so the guardrails pass, then
              approve.
            </p>
          ) : null}
          <ProblemNote error={reviewError} />
        </div>
      ) : null}
    </Card>
  );
}
