'use client';

import { Badge, Button, Card, CardTitle, ErrorNote, formatDateTime, Skeleton } from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

const SEVERITY_TONE = { info: 'blue', positive: 'green', warning: 'yellow' } as const;
const SEVERITY_ICON = { info: 'ℹ', positive: '▲', warning: '⚠' } as const;

function formatBasis(value: number | string): string {
  if (typeof value === 'number')
    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(4);
  return value;
}

export function InsightsCard({ days }: { days: number }) {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const period = Math.min(90, Math.max(1, days));
  const key = queryKeys.analytics(tenantId, 'insights', { days: period });
  const insights = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/analytics/insights', { params: { query: { days: period } } })),
    staleTime: 300_000,
  });
  const refresh = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.GET('/v1/admin/analytics/insights', {
          params: { query: { days: period, refresh: 'true' } },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const data = insights.data;
  return (
    <Card data-testid="insights-card">
      <CardTitle
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => refresh.mutate()}
            loading={refresh.isPending}
            data-testid="insights-refresh"
          >
            Refresh
          </Button>
        }
      >
        AI Insights
      </CardTitle>
      {data ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>
            model <code>{data.model}</code>
          </span>
          <span>· generated {formatDateTime(data.generatedAt)}</span>
          {data.cached ? <Badge>cached</Badge> : <Badge tone="green">fresh</Badge>}
        </p>
      ) : null}
      <ErrorNote error={insights.error} />
      {refresh.error ? <ErrorNote error={new Error(errorMessage(refresh.error))} /> : null}
      {insights.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : data && data.observations.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No observations for this period yet.</p>
      ) : (
        <ul className="space-y-3">
          {(data?.observations ?? []).map((o, index) => (
            <li
              key={`${o.title}-${index}`}
              data-testid="insight-item"
              data-severity={o.severity}
              className="rounded-md border border-slate-200 p-3 dark:border-slate-800"
            >
              <div className="flex items-start gap-2">
                <Badge tone={SEVERITY_TONE[o.severity]}>
                  <span aria-hidden="true">{SEVERITY_ICON[o.severity]}</span>&nbsp;{o.severity}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{o.title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{o.detail}</p>
                </div>
              </div>
              {o.basis.length > 0 ? (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-slate-500 dark:text-slate-400">
                    Based on which numbers
                  </summary>
                  <table className="mt-1 w-full max-w-md">
                    <tbody>
                      {o.basis.map((b) => (
                        <tr key={b.metric} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-0.5 pr-4 font-mono text-slate-500 dark:text-slate-400">
                            {b.metric}
                          </td>
                          <td className="py-0.5 text-right font-mono tabular-nums">{formatBasis(b.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        The model only sees aggregated metrics; every observation lists the numbers it was based on.
      </p>
    </Card>
  );
}
