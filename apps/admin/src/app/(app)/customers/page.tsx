'use client';

import {
  Badge,
  EmptyState,
  ErrorNote,
  formatDateTime,
  formatMoney,
  Input,
  Skeleton,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LoadMore } from '@/components/load-more';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

export default function CustomersPage() {
  const tenantId = useTenantId();
  const [q, setQ] = useState('');
  const list = useInfiniteQuery({
    queryKey: queryKeys.customers.list(tenantId, { q }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/v1/admin/customers', {
          params: { query: { limit: 50, ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div>
      <PageHeader title="Customers" />
      <Input
        aria-label="Search customers"
        placeholder="Search by email or name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-4 max-w-xs"
      />
      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title="No customers yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Account</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">LTV</Th>
              <Th>Since</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/customers/${c.id}`} className="hover:underline">
                    {c.email}
                  </Link>
                </Td>
                <Td>{c.name ?? '—'}</Td>
                <Td>{c.registered ? <Badge tone="green">registered</Badge> : <Badge>guest</Badge>}</Td>
                <Td className="text-right">{c.ordersCount}</Td>
                <Td className="text-right">{formatMoney(c.ltvCents)}</Td>
                <Td>{formatDateTime(c.createdAt)}</Td>
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
