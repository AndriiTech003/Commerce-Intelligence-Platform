'use client';

import { Badge, Card, CardTitle, formatMoney, KpiTile, statusTone } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, type ChartOption } from '@/components/chart';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { RingBuffer, upsertPoint } from '@/lib/ring-buffer';
import { useSession, useTenantId } from '@/lib/session';
import { ThrottleQueue } from '@/lib/throttle-queue';
import { useLiveChannel, type FeedMessage, type TickMessage } from '@/lib/use-live-channel';

type FeedItem = FeedMessage['item'];

const WINDOW = 300;

export default function LivePage() {
  const tenantId = useTenantId();
  const { tenant } = useSession();
  const currency = 'USD';
  const series = useRef(new RingBuffer<{ ts: number; value: number }>(WINDOW));
  const pendingTicks = useRef<TickMessage[]>([]);
  const feedQueue = useRef(new ThrottleQueue<FeedItem>(200));
  const [points, setPoints] = useState<Array<{ ts: number; value: number }>>([]);
  const [kpis, setKpis] = useState({ active: 0, eps: 0, revenue: 0, orders: 0 });
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const resync = useCallback(async () => {
    const snapshot = unwrap(await api.GET('/v1/admin/analytics/live'));
    series.current.replace(snapshot.series.map((p) => ({ ts: p.ts, value: p.eventsPerSec })));
    setPoints(series.current.toArray());
    const last = snapshot.series[snapshot.series.length - 1];
    setKpis({
      active: snapshot.activeVisitors,
      eps: last?.eventsPerSec ?? 0,
      revenue: snapshot.revenueTodayCents,
      orders: snapshot.ordersToday,
    });
    setFeed(snapshot.feed.slice(0, 30));
  }, []);

  const status = useLiveChannel(tenantId, {
    onTick: (tick) => {
      pendingTicks.current.push(tick);
    },
    onEvent: (item) => feedQueue.current.enqueue(item),
    onResync: () => void resync().catch(() => undefined),
  });

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const ticks = pendingTicks.current.splice(0);
      if (ticks.length > 0) {
        for (const tick of ticks) upsertPoint(series.current, { ts: tick.ts, value: tick.eventsPerSec });
        const latest = ticks[ticks.length - 1]!;
        setPoints(series.current.toArray());
        setKpis({
          active: latest.activeVisitors,
          eps: latest.eventsPerSec,
          revenue: latest.revenueTodayCents,
          orders: latest.ordersToday,
        });
      }
      const next = feedQueue.current.take(performance.now());
      if (next) setFeed((items) => [next, ...items.filter((i) => i.eventId !== next.eventId)].slice(0, 30));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  const funnel = useQuery({
    queryKey: queryKeys.analytics(tenantId, 'live-funnel', {}),
    queryFn: async () => unwrap(await api.GET('/v1/admin/analytics/live/funnel')),
    refetchInterval: 30_000,
  });

  const option = useMemo<ChartOption>(
    () => ({
      animation: false,
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'time', splitLine: { show: false } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: 'Events/sec',
          type: 'line',
          showSymbol: false,
          areaStyle: { opacity: 0.15 },
          data: points.map((p) => [p.ts, p.value]),
        },
      ],
    }),
    [points],
  );

  return (
    <div>
      <PageHeader
        title="Live"
        description={`Real-time activity${tenant ? ` for ${tenant.name}` : ''}`}
        actions={
          <Badge tone={statusTone(status)} className="text-sm">
            <span data-testid="live-status">{status}</span>
          </Badge>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Active visitors (5 min)" value={kpis.active} testId="kpi-active" />
        <KpiTile label="Events / sec" value={kpis.eps} testId="kpi-eps" />
        <KpiTile
          label="Revenue today"
          value={kpis.revenue}
          format={(v) => formatMoney(Math.round(v), currency)}
          testId="kpi-revenue"
        />
        <KpiTile label="Orders today" value={kpis.orders} testId="kpi-orders" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Events per second · last 5 minutes</CardTitle>
          <Chart option={option} testId="live-chart" />
        </Card>
        <Card>
          <CardTitle>Funnel · last hour</CardTitle>
          <ol className="space-y-2" data-testid="live-funnel">
            {(funnel.data?.steps ?? []).map((step) => {
              const first = funnel.data?.steps[0]?.users ?? 0;
              const width = first > 0 ? Math.max(4, (step.users / first) * 100) : 4;
              return (
                <li key={step.step}>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{step.step.replace(/_/g, ' ')}</span>
                    <span>{step.users}</span>
                  </div>
                  <div className="h-2 rounded bg-slate-100 dark:bg-slate-800">
                    <div className="h-2 rounded bg-[var(--brand)]" style={{ width: `${width}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
      <Card className="mt-4">
        <CardTitle>Live feed</CardTitle>
        {feed.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Waiting for events…</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="live-feed">
            {feed.map((item) => (
              <li
                key={item.eventId}
                className="flex items-center justify-between py-2 text-sm"
                data-testid="feed-item"
              >
                <span>{item.label}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {item.revenueCents ? `${formatMoney(item.revenueCents, currency)} · ` : ''}
                  {new Date(item.occurredAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
