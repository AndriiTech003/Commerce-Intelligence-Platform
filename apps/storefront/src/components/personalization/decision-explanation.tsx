'use client';

import type { ReactNode } from 'react';
import { ApiError } from '@cip/api-client';
import { Skeleton } from '@cip/ui';
import { formatPercent } from '@/lib/personalization';
import { useExplanation } from './use-personalization';
import { ContributionList } from './contribution-bars';

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Chip({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        strong
          ? 'bg-[var(--brand)] text-white'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
      }`}
    >
      {children}
    </span>
  );
}

export function DecisionExplanationView({ decisionId }: { decisionId: string }) {
  const { data, error, isPending } = useExplanation(decisionId, true);

  if (isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading explanation">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-testid="why-this-error">
        {notFound
          ? 'This explanation is only available to the visitor the decision was made for.'
          : 'The explanation could not be loaded right now.'}
      </p>
    );
  }

  const chosen = data.creative.chosen;

  return (
    <>
      {data.text.length ? (
        <Section title="In short" testId="why-this-text">
          <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
            {data.text.map((line, index) => (
              <li key={`${index}:${line}`}>{line}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Audience segment" testId="why-this-segment">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{data.segment.name}</span>
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
            {data.segment.key}
          </code>
          {data.coldStart ? <Chip>cold start</Chip> : null}
        </p>
        {data.segment.matchedRules.length ? (
          <ul className="space-y-1" data-testid="why-this-rules" aria-label="Matched rules">
            {data.segment.matchedRules.map((rule, index) => (
              <li key={`${index}:${rule}`} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 text-emerald-700 dark:text-emerald-400">
                  ✓
                </span>
                <code className="text-xs">{rule}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">
            No targeting rules matched — the default audience was used.
          </p>
        )}
        {data.otherSegments.length ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            Also in:
            {data.otherSegments.map((segment, index) => (
              <Chip key={`${index}:${segment}`}>{segment}</Chip>
            ))}
          </p>
        ) : null}
      </Section>

      <Section title="Profile signals" testId="why-this-signals">
        {data.profileSignals.length ? (
          <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
            {data.profileSignals.map((signal, index) => (
              <li key={`${index}:${signal}`}>{signal}</li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">
            No profile signals yet — browse a few products to build one.
          </p>
        )}
      </Section>

      <Section title="Creative selection" testId="why-this-creative">
        <p className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
          Policy <Chip>{data.creative.policy}</Chip>
          {data.creative.tone ? (
            <>
              chosen tone <Chip strong>{data.creative.tone}</Chip>
            </>
          ) : null}
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-xs" data-testid="why-this-arms">
            <caption className="sr-only">
              Creative variants (bandit arms) considered for this decision
            </caption>
            <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Tone
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Headline
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Impressions
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  CTR
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Sampled θ
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  P(best)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.creative.arms.map((arm) => {
                const isChosen = arm.id === chosen;
                return (
                  <tr
                    key={arm.id}
                    data-testid="why-this-arm"
                    data-chosen={isChosen ? 'true' : 'false'}
                    aria-current={isChosen ? 'true' : undefined}
                    className={
                      isChosen
                        ? 'bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] font-semibold'
                        : 'text-slate-700 dark:text-slate-300'
                    }
                  >
                    <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      {arm.tone ?? '—'}
                      {isChosen ? (
                        <span className="ml-2 rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                          chosen
                        </span>
                      ) : null}
                    </th>
                    <td className="max-w-[16rem] px-3 py-2">{arm.headline}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {arm.impressions.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPercent(arm.ctr)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {arm.sampled === null ? '—' : arm.sampled.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span
                          aria-hidden="true"
                          className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-slate-200 sm:inline-block dark:bg-slate-700"
                        >
                          <span
                            className="block h-full bg-[var(--brand)]"
                            style={{ width: `${Math.round(Math.max(0, Math.min(1, arm.pBest)) * 100)}%` }}
                          />
                        </span>
                        {formatPercent(arm.pBest, 0)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Why these products" testId="why-this-products">
        <ContributionList products={data.products} testId="why-this-contributions" />
      </Section>
    </>
  );
}
