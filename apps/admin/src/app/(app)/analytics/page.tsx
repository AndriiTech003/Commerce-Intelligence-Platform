'use client';

import { Card, CardTitle, ErrorNote, formatMoney, KpiTile, Select, Skeleton, Table, Td, Th } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import { Chart, type ChartOption } from '@/components/chart';
import { InsightsCard } from '@/components/insights-card';
import { SectionBoundary } from '@/components/section-boundary';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

const METRICS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'orders', label: 'Orders' },
  { id: 'events', label: 'Events' },
  { id: 'visitors', label: 'Visitors' },
  { id: 'product_views', label: 'Product views' },
] as const;

function periodFor(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Analytics() {
  const tenantId = useTenantId();
  const params = useSearchParams();
  const router = useRouter();
  const days = Number(params.get('days') ?? 30);
  const metric = (params.get('metric') ?? 'revenue') as (typeof METRICS)[number]['id'];
  const period = useMemo(() => periodFor(days), [days]);
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`/analytics?${next.toString()}`);
  };

  const overview = useQuery({
    queryKey: queryKeys.analytics(tenantId, 'overview', { days }),
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/analytics/overview', { params: { query: { ...period, compare: 'prev' } } }),
      ),
  });
  const series = useQuery({
    queryKey: queryKeys.analytics(tenantId, 'timeseries', { days, metric }),
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/analytics/timeseries', {
          params: { query: { ...period, metric, interval: days <= 2 ? 'hour' : 'day' } },
        }),
      ),
  });
  const funnel = useQuery({
    queryKey: queryKeys.analytics(tenantId, 'funnel', { days }),
    queryFn: async () => unwrap(await api.GET('/v1/admin/analytics/funnel', { params: { query: period } })),
  });
  const top = useQuery({
    queryKey: queryKeys.analytics(tenantId, 'top', { days }),
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/analytics/top-products', {
          params: { query: { ...period, by: 'revenue', limit: 10 } },
        }),
      ),
  });
  const cohorts = useQuery({
    queryKey: queryKeys.analytics(tenantId, 'cohorts', {}),
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/analytics/cohorts', { params: { query: { period: 'week', weeks: 8 } } }),
      ),
  });

  const chart = useMemo<ChartOption>(
    () => ({
      grid: { left: 56, right: 16, top: 16, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'time' },
      yAxis: { type: 'value' },
      series: [
        {
          type: metric === 'revenue' ? 'bar' : 'line',
          name: metric,
          showSymbol: false,
          data: (series.data?.points ?? []).map((p) => [p.t, metric === 'revenue' ? p.value / 100 : p.value]),
        },
      ],
    }),
    [series.data, metric],
  );

  const o = overview.data;
  return (
    <div>
      <PageHeader
        title="Analytics"
        actions={
          <Select
            aria-label="Period"
            value={String(days)}
            onChange={(event) => setParam('days', event.target.value)}
            className="w-40"
          >
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        }
      />
      <ErrorNote error={overview.error} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5" data-testid="analytics-overview">
        {o ? (
          <>
            <KpiTile
              label="Revenue"
              value={o.revenueCents.value}
              format={(v) => formatMoney(Math.round(v))}
              delta={o.revenueCents.deltaPct}
            />
            <KpiTile label="Orders" value={o.orders.value} delta={o.orders.deltaPct} />
            <KpiTile
              label="AOV"
              value={o.aovCents.value}
              format={(v) => formatMoney(Math.round(v))}
              delta={o.aovCents.deltaPct}
            />
            <KpiTile
              label="Conversion"
              value={o.conversionRate.value}
              format={(v) => `${v.toFixed(2)}%`}
              delta={o.conversionRate.deltaPct}
            />
            <KpiTile label="Visitors" value={o.visitors.value} delta={o.visitors.deltaPct} />
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)
        )}
      </div>
      <div className="mt-4">
        <SectionBoundary title="AI Insights">
          <InsightsCard days={days} />
        </SectionBoundary>
      </div>
      <Card className="mt-4">
        <CardTitle
          actions={
            <Select
              aria-label="Metric"
              value={metric}
              onChange={(event) => setParam('metric', event.target.value)}
              className="w-44"
            >
              {METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          }
        >
          Trend
        </CardTitle>
        <Chart option={chart} />
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Funnel</CardTitle>
          <ol className="space-y-3">
            {(funnel.data?.steps ?? []).map((step) => (
              <li key={step.step} className="text-sm">
                <div className="flex justify-between">
                  <span>{step.step.replace(/_/g, ' ')}</span>
                  <span className="tabular-nums">
                    {step.users}
                    {step.conversionFromPrev !== null ? (
                      <span className="ml-2 text-slate-500 dark:text-slate-400">
                        {step.conversionFromPrev}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-2 rounded bg-[var(--brand)]"
                    style={{
                      width: `${(funnel.data?.steps[0]?.users ?? 0) > 0 ? Math.max(3, (step.users / (funnel.data?.steps[0]?.users ?? 1)) * 100) : 3}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardTitle>Top products</CardTitle>
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th className="text-right">Views</Th>
                <Th className="text-right">Purchases</Th>
                <Th className="text-right">Revenue</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(top.data?.items ?? []).map((item) => (
                <tr key={item.productId}>
                  <Td>{item.title ?? item.productId.slice(0, 8)}</Td>
                  <Td className="text-right tabular-nums">{item.views}</Td>
                  <Td className="text-right tabular-nums">{item.purchases}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(item.revenueCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <Card className="mt-4">
        <CardTitle>Weekly retention cohorts</CardTitle>
        <Table>
          <thead>
            <tr>
              <Th>Cohort</Th>
              <Th>Size</Th>
              {Array.from({ length: 8 }, (_, i) => (
                <Th key={i}>W{i}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(cohorts.data?.cohorts ?? []).map((row) => (
              <tr key={row.cohort}>
                <Td>{row.cohort}</Td>
                <Td>{row.size}</Td>
                {row.retention.map((value, i) => (
                  <Td key={i} className="text-center tabular-nums">
                    <span
                      className="block rounded px-1"
                      style={{
                        background: `rgba(37, 99, 235, ${Math.min(0.85, value / 100)})`,
                        color: value > 50 ? 'white' : undefined,
                      }}
                    >
                      {value}%
                    </span>
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <Analytics />
    </Suspense>
  );
}
