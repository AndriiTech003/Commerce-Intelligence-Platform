'use client';

import { Badge, Card, CardTitle, ErrorNote, formatDateTime, Skeleton, Table, Td, Th } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { SectionBoundary } from '@/components/section-boundary';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { CONTRIBUTION_KEYS, readDecision } from '@/lib/decision';
import { colorFor, pct } from '@/lib/experiment';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

const CONTRIBUTION_LABELS: Record<(typeof CONTRIBUTION_KEYS)[number], string> = {
  similarity: 'Similarity',
  affinity: 'Category affinity',
  popularity: 'Popularity',
  priceFit: 'Price fit',
  freshness: 'Freshness',
};

export default function DecisionPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const decision = useQuery({
    queryKey: queryKeys.decisions.detail(tenantId, id),
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/decisions/{decisionId}', { params: { path: { decisionId: id } } })),
  });
  const view = useMemo(() => (decision.data ? readDecision(decision.data, id) : null), [decision.data, id]);
  if (decision.error) return <ErrorNote error={decision.error} />;
  if (!view) return <Skeleton className="h-96" />;
  const maxScore = Math.max(0.0001, ...view.products.map((p) => p.score));
  return (
    <div className="space-y-4" data-testid="decision-view">
      <PageHeader
        title="Why this ad?"
        description={`Decision ${view.decisionId}${view.decidedAt ? ` · ${formatDateTime(view.decidedAt)}` : ''}`}
      />
      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Placement</dt>
            <dd>{view.placement?.replace(/_/g, ' ') ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Policy</dt>
            <dd className="flex items-center gap-2">
              <code>{view.policy ?? '—'}</code>
              {view.coldStart ? <Badge tone="yellow">cold start</Badge> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Campaign</dt>
            <dd>
              {view.campaignId ? (
                <Link href={`/marketing/campaigns/${view.campaignId}`} className="hover:underline">
                  open campaign
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Profile</dt>
            <dd>
              {view.profileId ? (
                <Link href={`/profiles/${view.profileId}`} className="font-mono text-xs hover:underline">
                  {view.profileId.slice(0, 8)}
                </Link>
              ) : (
                '—'
              )}
              {view.source ? (
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">from {view.source}</span>
              ) : null}
            </dd>
          </div>
        </dl>
      </Card>
      {view.text.length > 0 ? (
        <Card>
          <CardTitle>In plain words</CardTitle>
          <ul className="list-inside list-disc space-y-1 text-sm" data-testid="decision-text">
            {view.text.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Assembled from a template, never by the LLM.
          </p>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="decision-segment">
          <CardTitle>Segment</CardTitle>
          <p className="text-sm">
            <span className="font-medium">{view.segment.name ?? view.segment.key}</span>{' '}
            <code className="text-xs text-slate-500 dark:text-slate-400">{view.segment.key}</code>
          </p>
          {view.segment.matchedRules.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1">
              {view.segment.matchedRules.map((rule) => (
                <li
                  key={rule}
                  className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                >
                  {rule}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              No target segment matched, so the shopper fell into _default.
            </p>
          )}
          {view.otherSegments.length > 0 ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Also matched (lower priority): {view.otherSegments.join(', ')}
            </p>
          ) : null}
        </Card>
        <Card>
          <CardTitle>Profile signals</CardTitle>
          {view.profileSignals.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No profile signals at decision time.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm">
              {view.profileSignals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <SectionBoundary title="Creative choice">
        <Card>
          <CardTitle>
            Creative chosen by Thompson sampling
            {view.chosen.headline ? (
              <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                “{view.chosen.headline}”
              </span>
            ) : null}
          </CardTitle>
          {view.arms.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No arms recorded.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Creative</Th>
                  <Th className="text-right">Impressions</Th>
                  <Th className="text-right">CTR</Th>
                  <Th className="text-right">Sampled θ</Th>
                  <Th>P(best)</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {view.arms.map((arm) => {
                  const chosen = arm.id === view.chosen.id;
                  return (
                    <tr
                      key={arm.id}
                      data-testid="decision-arm-row"
                      className={chosen ? 'bg-emerald-50 dark:bg-emerald-950/30' : undefined}
                    >
                      <Td>
                        <span className="font-medium">{arm.headline}</span>
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                          {arm.tone ?? 'no tone'}
                        </span>
                        {chosen ? (
                          <Badge tone="green" className="ml-2">
                            chosen
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="text-right tabular-nums">{arm.impressions}</Td>
                      <Td className="text-right tabular-nums">{pct(arm.ctr, 2)}</Td>
                      <Td className="text-right tabular-nums">
                        {arm.sampled === null ? '—' : pct(arm.sampled, 2)}
                      </Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-20 rounded bg-slate-100 dark:bg-slate-800"
                            aria-hidden="true"
                          >
                            <span
                              className="block h-1.5 rounded bg-emerald-500"
                              style={{ width: `${arm.pBest * 100}%` }}
                            />
                          </span>
                          <span className="tabular-nums">{pct(arm.pBest)}</span>
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Each arm drew θ ~ Beta(1 + clicks, 1 + impressions − clicks); the highest draw wins.
          </p>
        </Card>
      </SectionBoundary>
      <SectionBoundary title="Products">
        <Card>
          <CardTitle>Products and why they ranked</CardTitle>
          <ul className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
            {CONTRIBUTION_KEYS.map((key, index) => (
              <li key={key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: colorFor(index) }}
                  aria-hidden="true"
                />
                {CONTRIBUTION_LABELS[key]}
              </li>
            ))}
          </ul>
          {view.products.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No products recorded.</p>
          ) : (
            <ul className="space-y-3">
              {view.products.map((product) => (
                <li key={product.id} data-testid="decision-product" className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/products/${product.id}`} className="font-medium hover:underline">
                      {product.title ?? product.id.slice(0, 8)}
                    </Link>
                    <span className="tabular-nums text-slate-500 dark:text-slate-400">
                      score {product.score.toFixed(3)}
                    </span>
                  </div>
                  <div
                    className="mt-1 flex h-3 overflow-hidden rounded bg-slate-100 dark:bg-slate-800"
                    style={{ width: `${Math.max(8, (product.score / maxScore) * 100)}%` }}
                    role="img"
                    aria-label={product.contributions
                      .map(
                        (c) =>
                          `${CONTRIBUTION_LABELS[c.key as keyof typeof CONTRIBUTION_LABELS]} ${c.value.toFixed(3)}`,
                      )
                      .join(', ')}
                  >
                    {product.contributions.map((c, index) => (
                      <span
                        key={c.key}
                        title={`${c.key}: ${c.value.toFixed(3)}`}
                        style={{
                          width: `${product.score > 0 ? (Math.max(0, c.value) / product.score) * 100 : 0}%`,
                          background: colorFor(index),
                        }}
                        className="h-3 border-r-2 border-white last:border-r-0 dark:border-slate-900"
                      />
                    ))}
                  </div>
                  {product.strategies.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      via {product.strategies.join(', ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </SectionBoundary>
      <details className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
        <summary className="cursor-pointer">Raw explanation JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-50 p-2 text-xs dark:bg-slate-950">
          {JSON.stringify(decision.data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
