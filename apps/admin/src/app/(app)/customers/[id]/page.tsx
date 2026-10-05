'use client';

import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  ErrorNote,
  formatDateTime,
  formatMoney,
  KpiTile,
  Skeleton,
  statusTone,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ProfileView } from '@/components/profile-view';
import { SectionBoundary } from '@/components/section-boundary';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

const EVENT_TONE: Record<string, 'green' | 'blue' | 'yellow' | 'neutral'> = {
  order_placed: 'green',
  checkout_started: 'yellow',
  cart_item_added: 'yellow',
  ad_clicked: 'blue',
  ad_impression: 'neutral',
};

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function Timeline({ id }: { id: string }) {
  const tenantId = useTenantId();
  const timeline = useQuery({
    queryKey: queryKeys.customers.timeline(tenantId, id),
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/customers/{id}/timeline', { params: { path: { id } } })),
  });
  const rows = timeline.data?.data ?? [];
  return (
    <Card>
      <CardTitle>Recent events</CardTitle>
      <ErrorNote error={timeline.error} />
      {timeline.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No events yet" description="Storefront events from ClickHouse appear here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Event</Th>
              <Th>Product</Th>
              <Th className="text-right">Revenue</Th>
              <Th>Context</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="timeline-table">
            {rows.map((event, index) => {
              const type = text(event.eventType) ?? 'event';
              const productId = text(event.productId);
              const revenue = Number(event.revenueCents ?? 0);
              const occurred = text(event.occurredAt);
              return (
                <tr key={text(event.eventId) ?? index} data-testid="timeline-row">
                  <Td className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                    {occurred
                      ? formatDateTime(occurred.includes('T') ? occurred : `${occurred.replace(' ', 'T')}Z`)
                      : '—'}
                  </Td>
                  <Td>
                    <Badge tone={EVENT_TONE[type] ?? 'neutral'}>{type.replace(/_/g, ' ')}</Badge>
                  </Td>
                  <Td>
                    {productId && !productId.startsWith('00000000') ? (
                      <Link href={`/products/${productId}`} className="font-mono text-xs hover:underline">
                        {productId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">—</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{revenue > 0 ? formatMoney(revenue) : '—'}</Td>
                  <Td className="text-xs text-slate-500 dark:text-slate-400">
                    {[text(event.country), text(event.device)].filter(Boolean).join(' · ') || '—'}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function CustomerProfile({ id }: { id: string }) {
  const tenantId = useTenantId();
  const profile = useQuery({
    queryKey: queryKeys.customers.profile(tenantId, id),
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/customers/{id}/profile', { params: { path: { id } } })),
  });
  if (profile.error) return <ErrorNote error={profile.error} />;
  if (!profile.data) return <Skeleton className="h-72" />;
  return <ProfileView profile={profile.data} />;
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const customer = useQuery({
    queryKey: queryKeys.customers.detail(tenantId, id),
    queryFn: async () => unwrap(await api.GET('/v1/admin/customers/{id}', { params: { path: { id } } })),
  });
  if (customer.error) return <ErrorNote error={customer.error} />;
  const c = customer.data;
  if (!c) return <Skeleton className="h-96" />;
  return (
    <div>
      <PageHeader title={c.name ?? c.email} description={c.email} />
      <div className="grid grid-cols-2 gap-4">
        <KpiTile label="Orders" value={c.ordersCount} />
        <KpiTile label="Lifetime value" value={c.ltvCents} format={(v) => formatMoney(Math.round(v))} />
      </div>
      <div className="mt-4">
        <SectionBoundary title="Personalization profile">
          <CustomerProfile id={id} />
        </SectionBoundary>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card>
          <CardTitle>Orders</CardTitle>
          {c.orders.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {c.orders.map((o) => (
                <li key={o.id} className="flex justify-between py-2">
                  <Link href={`/orders/${o.id}`} className="hover:underline">
                    #{o.number} · {formatDateTime(o.placedAt)}
                  </Link>
                  <span className="space-x-2">
                    <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                    <span>{formatMoney(o.totalCents, o.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <SectionBoundary title="Timeline">
          <Timeline id={id} />
        </SectionBoundary>
      </div>
    </div>
  );
}
