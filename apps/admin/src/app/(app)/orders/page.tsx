'use client';

import { ORDER_STATUSES } from '@cip/contracts';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  formatDateTime,
  formatMoney,
  Input,
  Select,
  Skeleton,
  statusTone,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoadMore } from '@/components/load-more';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

const VIEWS = [
  { label: 'All', query: '' },
  { label: 'Unfulfilled', query: 'status=paid' },
  { label: 'Awaiting payment', query: 'status=pending_payment' },
  { label: 'Failed payments', query: 'status=payment_failed' },
];

function Orders() {
  const tenantId = useTenantId();
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get('status') ?? '';
  const email = params.get('email') ?? '';
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/orders?${next.toString()}`);
  };
  const list = useInfiniteQuery({
    queryKey: queryKeys.orders.list(tenantId, { status, email }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/v1/admin/orders', {
          params: {
            query: {
              limit: 25,
              ...(status ? { status: status as (typeof ORDER_STATUSES)[number] } : {}),
              ...(email ? { email } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div>
      <PageHeader title="Orders" />
      <div className="mb-3 flex flex-wrap gap-2">
        {VIEWS.map((view) => (
          <Button
            key={view.label}
            variant={params.toString() === view.query ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => router.replace(`/orders${view.query ? `?${view.query}` : ''}`)}
          >
            {view.label}
          </Button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
          className="w-48"
          data-testid="order-status-filter"
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Customer email"
          placeholder="Customer email"
          defaultValue={email}
          onKeyDown={(e) => e.key === 'Enter' && setParam('email', e.currentTarget.value)}
          className="max-w-xs"
        />
      </div>
      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description="Orders placed on the storefront show up here in real time."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Placed</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th className="text-right">Items</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((o) => (
              <tr key={o.id} data-testid="order-row">
                <Td>
                  <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                    #{o.number}
                  </Link>
                </Td>
                <Td>{formatDateTime(o.placedAt)}</Td>
                <Td>{o.email}</Td>
                <Td>
                  <Badge tone={statusTone(o.status)}>{o.status.replace('_', ' ')}</Badge>
                </Td>
                <Td className="text-right tabular-nums">{o.itemsCount}</Td>
                <Td className="text-right tabular-nums">{formatMoney(o.totalCents, o.currency)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <LoadMore
        hasMore={Boolean(list.hasNextPage)}
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}
