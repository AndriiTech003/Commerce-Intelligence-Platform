'use client';

import { Badge, Card, CardTitle, formatDateTime, formatMoney } from '@cip/ui';
import Link from 'next/link';
import type { ProfileView as Profile } from '@/lib/types';

const SOURCE_TONE = { live: 'green', snapshot: 'blue', none: 'neutral' } as const;
const SOURCE_HELP = {
  live: 'Read from the live Redis profile',
  snapshot: 'Read from the last Postgres snapshot',
  none: 'No behaviour recorded for this profile yet',
} as const;

function AffinityBars({
  title,
  items,
  color,
  limit = 8,
}: {
  title: string;
  items: Array<{ key: string; score: number }>;
  color: string;
  limit?: number;
}) {
  const shown = [...items].sort((a, b) => b.score - a.score).slice(0, limit);
  const max = Math.max(0, ...shown.map((i) => i.score));
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No signal yet</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((item) => (
            <li
              key={item.key}
              className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-2 text-sm"
            >
              <span className="truncate font-mono text-xs" title={item.key}>
                {item.key}
              </span>
              <span className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                <span
                  className="block h-2.5 rounded-full"
                  style={{
                    width: `${max > 0 ? Math.max(3, (item.score / max) * 100) : 0}%`,
                    background: color,
                  }}
                />
              </span>
              <span className="text-right tabular-nums text-slate-600 dark:text-slate-300">
                {item.score.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IntentMeter({ value }: { value: number }) {
  const clamped = Math.min(1, Math.max(0, value));
  const tone = clamped >= 0.7 ? 'bg-emerald-500' : clamped >= 0.3 ? 'bg-amber-500' : 'bg-slate-400';
  const label = clamped >= 0.7 ? 'high' : clamped >= 0.3 ? 'warming up' : 'browsing';
  return (
    <div data-testid="profile-intent" data-value={clamped.toFixed(3)}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Purchase intent
        </span>
        <span className="text-sm tabular-nums">
          {clamped.toFixed(2)} <span className="text-xs text-slate-500 dark:text-slate-400">· {label}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="Purchase intent"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(clamped.toFixed(2))}
        className="relative mt-2 h-3 rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <div className={`h-3 rounded-full ${tone}`} style={{ width: `${clamped * 100}%` }} />
        <span
          className="absolute top-0 h-3 border-l-2 border-dashed border-slate-500"
          style={{ left: '70%' }}
          title="high_intent threshold (0.7)"
          aria-hidden="true"
        />
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        1 − e^(−x) over the last 30 minutes of the session
      </p>
    </div>
  );
}

function formatFeature(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ProfileView({ profile, currency = 'USD' }: { profile: Profile; currency?: string }) {
  const features = Object.entries(profile.features).sort(([a], [b]) => a.localeCompare(b));
  const empty =
    profile.source === 'none' &&
    profile.affinity.categories.length === 0 &&
    profile.segments.length === 0 &&
    profile.signals.length === 0;
  return (
    <Card data-testid="profile-view">
      <CardTitle
        actions={
          <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span title={SOURCE_HELP[profile.source]}>
              <Badge tone={SOURCE_TONE[profile.source]}>{profile.source}</Badge>
            </span>
            {profile.updatedAt ? <span>updated {formatDateTime(profile.updatedAt)}</span> : null}
          </span>
        }
      >
        Personalization profile
      </CardTitle>
      {empty ? (
        <p
          className="mb-4 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 dark:text-slate-400 dark:border-slate-700"
          data-testid="profile-empty"
        >
          No behaviour recorded yet. Affinities, intent and segments appear after the first tracked storefront
          events.
        </p>
      ) : null}
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2" data-testid="profile-affinity">
            <AffinityBars title="Category affinity" items={profile.affinity.categories} color="#2a78d6" />
            <div className="grid gap-5 sm:grid-cols-2">
              <AffinityBars
                title="Brand affinity"
                items={profile.affinity.brands}
                color="#1baf7a"
                limit={6}
              />
              <AffinityBars title="Creative tones clicked" items={profile.affinity.tones} color="#eb6834" />
            </div>
          </div>
          <div className="space-y-5">
            <IntentMeter value={profile.intent} />
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Price band
              </span>
              <div className="mt-1 flex items-center gap-2" data-testid="profile-price">
                <Badge
                  tone={
                    profile.priceBand === 'high' ? 'blue' : profile.priceBand === 'low' ? 'yellow' : 'neutral'
                  }
                >
                  {profile.priceBand ?? 'unknown'}
                </Badge>
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  EWMA {formatMoney(profile.priceEwmaCents, currency)}
                </span>
              </div>
            </div>
            {profile.recentProducts.length > 0 ? (
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Recent products ({profile.recentProducts.length})
                </span>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {profile.recentProducts.slice(0, 8).map((id) => (
                    <li key={id}>
                      <Link
                        href={`/products/${id}`}
                        className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs hover:underline dark:bg-slate-800"
                      >
                        {id.slice(0, 8)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Segments
            </h3>
            <ul className="space-y-2" data-testid="profile-segments">
              {profile.segments.length === 0 ? (
                <li className="text-sm text-slate-500 dark:text-slate-400">Not in any segment</li>
              ) : (
                [...profile.segments]
                  .sort((a, b) => a.priority - b.priority)
                  .map((segment) => (
                    <li
                      key={segment.key}
                      data-testid="profile-segment"
                      data-key={segment.key}
                      className="rounded-md border border-slate-200 p-2 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{segment.name}</span>
                        <span className="flex items-center gap-1">
                          <code className="text-xs text-slate-500 dark:text-slate-400">{segment.key}</code>
                          <Badge>p{segment.priority}</Badge>
                        </span>
                      </div>
                      {segment.reasons.length > 0 ? (
                        <ul className="mt-1 flex flex-wrap gap-1">
                          {segment.reasons.map((reason) => (
                            <li
                              key={reason}
                              className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            >
                              {reason}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))
              )}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Signals
            </h3>
            {profile.signals.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No signals yet</p>
            ) : (
              <ul className="list-inside list-disc space-y-1 text-sm" data-testid="profile-signals">
                {profile.signals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {features.length > 0 ? (
          <details className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-800">
            <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
              All features ({features.length})
            </summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {features.map(([key, value]) => (
                <div
                  key={key}
                  className="flex justify-between gap-2 border-b border-slate-100 py-0.5 dark:border-slate-800"
                >
                  <dt className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{key}</dt>
                  <dd className="font-mono text-xs tabular-nums">{formatFeature(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
