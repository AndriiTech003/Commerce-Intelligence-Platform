'use client';

import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  ErrorNote,
  formatNumber,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import {
  colorFor,
  formatInterval,
  historySeries,
  lift,
  pct,
  SERIES_COLORS,
  trafficShare,
} from '@/lib/experiment';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';
import type { Experiment, ExperimentSegment } from '@/lib/types';
import { BetaDensityChart, type DensityInput } from './beta-density';
import { Chart, type ChartOption } from './chart';
import { SectionBoundary } from './section-boundary';

const GRID_LINE = { lineStyle: { color: 'rgba(148, 163, 184, 0.25)' } };

interface ArmLabel {
  label: string;
  color: string;
}

function useArmLabels(experiment: Experiment | undefined): Map<string, ArmLabel> {
  return useMemo(() => {
    const map = new Map<string, { headline: string; tone: string | null }>();
    for (const segment of experiment?.segments ?? [])
      for (const arm of segment.arms) map.set(arm.creativeId, { headline: arm.headline, tone: arm.tone });
    for (const point of experiment?.traffic.points ?? [])
      if (!map.has(point.creativeId)) map.set(point.creativeId, { headline: 'retired creative', tone: null });
    const ids = [...map.keys()].sort();
    return new Map(
      ids.map((id, index) => {
        const info = map.get(id)!;
        const headline = info.headline.length > 32 ? `${info.headline.slice(0, 31)}…` : info.headline;
        return [id, { label: `${info.tone ?? 'untoned'} · ${headline}`, color: colorFor(index) }];
      }),
    );
  }, [experiment]);
}

function IntervalBar({ rate, low, high, scale }: { rate: number; low: number; high: number; scale: number }) {
  const at = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <span
      className="relative mt-1 block h-1.5 w-28 rounded bg-slate-100 dark:bg-slate-800"
      aria-hidden="true"
    >
      <span
        className="absolute top-0 h-1.5 rounded bg-blue-300 dark:bg-blue-700"
        style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }}
      />
      <span
        className="absolute -top-0.5 h-2.5 w-0.5 bg-blue-700 dark:bg-blue-300"
        style={{ left: at(rate) }}
      />
    </span>
  );
}

function SegmentArms({
  segment,
  labels,
  successLabel,
}: {
  segment: ExperimentSegment;
  labels: Map<string, ArmLabel>;
  successLabel: string;
}) {
  const scale = Math.max(0.0001, ...segment.arms.map((a) => a.high)) * 1.1;
  const leader = segment.arms.reduce<string | null>(
    (best, arm) =>
      best === null || arm.pBest > (segment.arms.find((a) => a.creativeId === best)?.pBest ?? 0)
        ? arm.creativeId
        : best,
    null,
  );
  const density = useMemo<DensityInput[]>(
    () =>
      segment.arms.map((arm) => ({
        id: arm.creativeId,
        label: labels.get(arm.creativeId)?.label ?? arm.headline,
        color: labels.get(arm.creativeId)?.color ?? SERIES_COLORS[0],
        alpha: arm.alpha,
        beta: arm.beta,
        high: arm.high,
      })),
    [segment.arms, labels],
  );
  return (
    <Card data-testid="experiment-segment" data-segment={segment.segmentKey}>
      <CardTitle
        actions={
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {formatNumber(segment.impressions)} impressions · {formatNumber(segment.successes)}{' '}
            {successLabel.toLowerCase()}
          </span>
        }
      >
        <code className="text-sm">{segment.segmentKey}</code>
      </CardTitle>
      {segment.arms.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No approved creatives compete in this segment yet.
        </p>
      ) : (
        <div className="space-y-4">
          <Table>
            <thead>
              <tr>
                <Th>Creative</Th>
                <Th>Status</Th>
                <Th className="text-right">Impressions</Th>
                <Th className="text-right">{successLabel}</Th>
                <Th>Rate (95% Wilson)</Th>
                <Th>P(best)</Th>
                <Th className="text-right">α / β</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {segment.arms.map((arm) => {
                const label = labels.get(arm.creativeId);
                return (
                  <tr key={arm.creativeId} data-testid="arm-row" data-creative-id={arm.creativeId}>
                    <Td>
                      <span className="flex items-start gap-2">
                        <span
                          className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: label?.color }}
                          aria-hidden="true"
                        />
                        <span>
                          <span className="block font-medium">{arm.headline}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {arm.tone ?? 'no tone'}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={arm.status === 'active' ? 'green' : 'neutral'}>{arm.status}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <span data-testid="arm-impressions">{formatNumber(arm.impressions)}</span>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <span data-testid="arm-successes">{formatNumber(arm.successes)}</span>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      <span data-testid="arm-rate">{formatInterval(arm.rate, arm.low, arm.high)}</span>
                      <IntervalBar rate={arm.rate} low={arm.low} high={arm.high} scale={scale} />
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-16 rounded bg-slate-100 dark:bg-slate-800"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-1.5 rounded bg-emerald-500"
                            style={{ width: `${arm.pBest * 100}%` }}
                          />
                        </span>
                        <span data-testid="arm-pbest">{pct(arm.pBest)}</span>
                        {leader === arm.creativeId && segment.arms.length > 1 ? (
                          <Badge tone="green">leader</Badge>
                        ) : null}
                      </span>
                    </Td>
                    <Td className="text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                      {arm.alpha} / {arm.beta}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Posterior Beta densities
            </h3>
            <BetaDensityChart arms={density} />
          </div>
        </div>
      )}
    </Card>
  );
}

function HoldoutComparison({ experiment, successLabel }: { experiment: Experiment; successLabel: string }) {
  const rows = [
    { name: 'Personalized (bandit)', group: experiment.personalized },
    { name: 'Holdout (random creative, popular products)', group: experiment.holdout },
  ];
  const delta = lift(experiment.personalized.rate, experiment.holdout.rate);
  return (
    <Card data-testid="holdout-comparison">
      <CardTitle
        actions={
          delta !== null ? (
            <Badge tone={delta >= 0 ? 'green' : 'red'}>
              {delta >= 0 ? '+' : ''}
              {delta.toFixed(1)}% lift
            </Badge>
          ) : null
        }
      >
        Personalized vs holdout
      </CardTitle>
      <Table>
        <thead>
          <tr>
            <Th>Group</Th>
            <Th className="text-right">Impressions</Th>
            <Th className="text-right">Clicks</Th>
            <Th className="text-right">Conversions</Th>
            <Th className="text-right">{successLabel} rate</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(({ name, group }) => (
            <tr key={name}>
              <Td>{name}</Td>
              <Td className="text-right tabular-nums">{formatNumber(group.impressions)}</Td>
              <Td className="text-right tabular-nums">{formatNumber(group.clicks)}</Td>
              <Td className="text-right tabular-nums">{formatNumber(group.conversions)}</Td>
              <Td className="text-right tabular-nums">{pct(group.rate, 2)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function regretAxisIsTime(series: Array<{ t: number }>): boolean {
  return series.some((p) => p.t > 1e11);
}

function RegretCard({
  regret,
  successLabel,
}: {
  regret: NonNullable<Experiment['regret']>;
  successLabel: string;
}) {
  const option = useMemo<ChartOption>(
    () => ({
      color: [SERIES_COLORS[0], SERIES_COLORS[1]],
      grid: { left: 52, right: 16, top: 16, bottom: 52 },
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0 },
      xAxis: regretAxisIsTime(regret.series)
        ? { type: 'time' }
        : { type: 'value', name: 'decisions', nameLocation: 'middle', nameGap: 24 },
      yAxis: { splitLine: GRID_LINE, type: 'value', name: 'regret' },
      series: [
        {
          type: 'line',
          name: 'Thompson sampling',
          showSymbol: false,
          lineStyle: { width: 2 },
          data: regret.series.map((p) => [p.t, Number(p.thompson.toFixed(2))]),
        },
        {
          type: 'line',
          name: 'Uniform A/B',
          showSymbol: false,
          lineStyle: { width: 2 },
          data: regret.series.map((p) => [p.t, Number(p.uniform.toFixed(2))]),
        },
      ],
    }),
    [regret],
  );
  const unit = successLabel.toLowerCase();
  return (
    <Card data-testid="regret-card">
      <CardTitle>Cumulative regret vs oracle</CardTitle>
      <p className="mb-2 text-sm" data-testid="regret-summary">
        Over {formatNumber(regret.decisions)} decisions Thompson lost{' '}
        <strong className="tabular-nums">{formatNumber(Math.round(regret.thompson))}</strong> {unit}, uniform
        A/B lost <strong className="tabular-nums">{formatNumber(Math.round(regret.uniform))}</strong> {unit}.
      </p>
      {regret.series.length > 1 ? (
        <Chart
          option={option}
          height={240}
          replace
          label="Cumulative regret, Thompson sampling versus uniform A/B"
        />
      ) : null}
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        On simulated traffic: the oracle knows each persona’s true CTR.
      </p>
    </Card>
  );
}

export function ExperimentView({ campaignId }: { campaignId: string }) {
  const tenantId = useTenantId();
  const [segmentKey, setSegmentKey] = useState<string>('');
  const experiment = useQuery({
    queryKey: queryKeys.campaigns.experiment(tenantId, campaignId),
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/campaigns/{id}/experiment', { params: { path: { id: campaignId } } })),
    refetchInterval: 5000,
  });
  const data = experiment.data;
  const labels = useArmLabels(data);
  const selected = segmentKey === '' ? null : segmentKey;
  const successLabel = data?.goal === 'conversion' ? 'Conversions' : 'Clicks';

  const traffic = useMemo(() => trafficShare(data?.traffic.points ?? [], selected), [data, selected]);
  const trafficOption = useMemo<ChartOption>(
    () => ({
      color: traffic.creativeIds.map((id) => labels.get(id)?.color ?? SERIES_COLORS[0]),
      grid: { left: 48, right: 16, top: 16, bottom: 56 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: unknown) => `${Number(value).toFixed(1)}%`,
      },
      legend: { type: 'scroll', bottom: 0 },
      xAxis: { type: 'time' },
      yAxis: { splitLine: GRID_LINE, type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
      series: traffic.creativeIds.map((id) => ({
        type: 'line',
        name: labels.get(id)?.label ?? id.slice(0, 8),
        stack: 'share',
        showSymbol: false,
        lineStyle: { width: 1 },
        areaStyle: { opacity: 0.85 },
        emphasis: { focus: 'series' },
        data: traffic.times.map((t, i) => [t, traffic.shares[id]![i]!]),
      })),
    }),
    [traffic, labels],
  );

  const history = useMemo(() => historySeries(data?.history ?? [], selected), [data, selected]);
  const historyOption = useMemo<ChartOption>(
    () => ({
      grid: { left: 52, right: 16, top: 16, bottom: 56 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: unknown) => `${(Number(value) * 100).toFixed(2)}%`,
      },
      legend: { type: 'scroll', bottom: 0 },
      xAxis: { type: 'time' },
      yAxis: {
        splitLine: GRID_LINE,
        type: 'value',
        axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(1)}%` },
      },
      series: history.map((h) => {
        const [segmentPart, creativePart] = h.creativeId.includes(':')
          ? h.creativeId.split(':')
          : [null, h.creativeId];
        const label = labels.get(creativePart ?? '');
        return {
          type: 'line',
          name: segmentPart
            ? `${segmentPart} · ${label?.label ?? creativePart}`
            : (label?.label ?? h.creativeId),
          showSymbol: false,
          lineStyle: { width: 2, ...(segmentPart ? { opacity: 0.7 } : {}) },
          itemStyle: { color: label?.color },
          data: h.points,
        };
      }),
    }),
    [history, labels],
  );

  if (experiment.error) return <ErrorNote error={experiment.error} />;
  if (!data)
    return (
      <div className="space-y-3" data-testid="experiment-view" aria-busy="true">
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );

  const segments = selected ? data.segments.filter((s) => s.segmentKey === selected) : data.segments;
  return (
    <div className="space-y-4" data-testid="experiment-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Thompson sampling per segment, refreshed every 5 s. Goal: <strong>{data.goal}</strong>.
        </p>
        <div className="w-56">
          <Select
            aria-label="Segment"
            value={segmentKey}
            onChange={(e) => setSegmentKey(e.target.value)}
            data-testid="experiment-segment-select"
          >
            <option value="">All segments</option>
            {data.segments.map((s) => (
              <option key={s.segmentKey} value={s.segmentKey}>
                {s.segmentKey}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionBoundary title="Holdout comparison">
          <HoldoutComparison experiment={data} successLabel={successLabel} />
        </SectionBoundary>
        {data.regret ? (
          <SectionBoundary title="Regret">
            <RegretCard regret={data.regret} successLabel={successLabel} />
          </SectionBoundary>
        ) : (
          <Card>
            <CardTitle>Cumulative regret</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Regret against the oracle is only known for simulator traffic. Start the simulator to compare
              Thompson sampling with a uniform A/B split.
            </p>
          </Card>
        )}
      </div>
      <SectionBoundary title="Traffic share">
        <Card>
          <CardTitle>Traffic share by creative over time{selected ? ` · ${selected}` : ''}</CardTitle>
          {traffic.times.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No decisions recorded in this window yet.
            </p>
          ) : (
            <Chart
              option={trafficOption}
              height={280}
              replace
              testId="traffic-share-chart"
              label="Stacked area chart of the share of decisions per creative over time"
            />
          )}
        </Card>
      </SectionBoundary>
      {segments.length === 0 ? (
        <EmptyState
          title="No experiment data yet"
          description="Approve creatives and activate the campaign."
        />
      ) : (
        segments.map((segment) => (
          <SectionBoundary key={segment.segmentKey} title={`Segment ${segment.segmentKey}`}>
            <SegmentArms segment={segment} labels={labels} successLabel={successLabel} />
          </SectionBoundary>
        ))
      )}
      {history.length > 0 ? (
        <SectionBoundary title="Bandit history">
          <Card>
            <CardTitle>Posterior mean α/(α+β) from bandit snapshots</CardTitle>
            <Chart
              option={historyOption}
              height={260}
              replace
              label="Posterior mean per creative over time"
            />
          </Card>
        </SectionBoundary>
      ) : null}
    </div>
  );
}
