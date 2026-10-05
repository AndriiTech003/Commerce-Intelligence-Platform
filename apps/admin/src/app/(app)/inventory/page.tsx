'use client';

import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, Skeleton, Table, Td, Th } from '@cip/ui';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useState } from 'react';
import { LoadMore } from '@/components/load-more';
import { PageHeader } from '@/components/shell';
import { api, errorMessage, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';

async function fetchPage(params: { q: string; lowStock: boolean; cursor?: string | undefined }) {
  return unwrap(
    await api.GET('/v1/admin/inventory', {
      params: {
        query: {
          limit: 50,
          ...(params.q ? { q: params.q } : {}),
          ...(params.lowStock ? { lowStock: 'true' as const } : {}),
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
      },
    }),
  );
}

type Page = Awaited<ReturnType<typeof fetchPage>>;
type Row = Page['data'][number];

export default function InventoryPage() {
  const tenantId = useTenantId();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const key = queryKeys.inventory(tenantId, { q, lowStock });
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPage({ q, lowStock, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const adjust = useMutation({
    mutationFn: async (input: { variantId: string; delta: number; reason: string }) =>
      unwrap(
        await api.POST('/v1/admin/inventory/{variantId}/adjust', {
          params: { path: { variantId: input.variantId } },
          body: { delta: input.delta, reason: input.reason },
        }),
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<InfiniteData<Page>>(key);
      queryClient.setQueryData<InfiniteData<Page>>(key, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                data: page.data.map((row) =>
                  row.variantId === input.variantId
                    ? { ...row, onHand: row.onHand + input.delta, available: row.available + input.delta }
                    : row,
                ),
              })),
            }
          : data,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
    onSuccess: () => {
      setEditing(null);
      setDelta('');
      setReason('');
    },
  });

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div>
      <PageHeader title="Inventory" description="On hand, reserved by open checkouts, and available stock." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          aria-label="Search SKU or product"
          placeholder="Search SKU or product"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} /> Low
          stock only
        </label>
      </div>
      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Reserved</Th>
              <Th className="text-right">Available</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={row.variantId} data-testid="inventory-row">
                <Td>
                  {row.productTitle}
                  <div className="text-xs text-slate-500 dark:text-slate-400">{row.variantTitle}</div>
                </Td>
                <Td>{row.sku}</Td>
                <Td className="text-right tabular-nums">{row.onHand}</Td>
                <Td className="text-right tabular-nums">{row.reserved}</Td>
                <Td className="text-right tabular-nums">
                  {row.available} {row.lowStock ? <Badge tone="yellow">low</Badge> : null}
                </Td>
                <Td className="text-right">
                  {can('inventory:write') ? (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
                      Adjust
                    </Button>
                  ) : null}
                </Td>
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
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Adjust ${editing?.sku ?? ''}`}
        footer={
          <Button
            loading={adjust.isPending}
            disabled={!Number(delta) || !reason}
            onClick={() =>
              editing && adjust.mutate({ variantId: editing.variantId, delta: Number(delta), reason })
            }
          >
            Apply
          </Button>
        }
      >
        <Field label="Change (+/−)" htmlFor="delta">
          <Input id="delta" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="reason">
          <Input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Stock count, damaged, received shipment…"
          />
        </Field>
        {adjust.error ? <ErrorNote error={new Error(errorMessage(adjust.error))} /> : null}
      </Modal>
    </div>
  );
}
