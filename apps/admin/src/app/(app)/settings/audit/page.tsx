'use client';

import { Button, EmptyState, ErrorNote, formatDateTime, Input, Skeleton, Table, Td, Th } from '@cip/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { LoadMore } from '@/components/load-more';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

export default function AuditPage() {
  const tenantId = useTenantId();
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: queryKeys.audit(tenantId, { entityType }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/v1/admin/audit-log', {
          params: {
            query: {
              limit: 50,
              ...(entityType ? { entityType } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every change in the admin with who, what and a field-level diff."
      />
      <Input
        aria-label="Entity type"
        placeholder="Filter by entity (product, order, discount…)"
        value={entityType}
        onChange={(e) => setEntityType(e.target.value)}
        className="mb-4 max-w-xs"
      />
      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState title="No changes recorded yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((entry) => (
              <Fragment key={entry.id}>
                <tr data-testid="audit-row">
                  <Td>{formatDateTime(entry.createdAt)}</Td>
                  <Td>{entry.actorName ?? entry.actorType}</Td>
                  <Td className="font-mono text-xs">{entry.action}</Td>
                  <Td className="text-xs">
                    {entry.entityType} {entry.entityId?.slice(0, 8)}
                  </Td>
                  <Td className="text-right">
                    {entry.diff ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen(open === entry.id ? null : entry.id)}
                      >
                        {open === entry.id ? 'Hide diff' : 'Show diff'}
                      </Button>
                    ) : null}
                  </Td>
                </tr>
                {open === entry.id && entry.diff ? (
                  <tr>
                    <Td colSpan={5}>
                      <ul className="space-y-1 text-xs">
                        {Object.entries(entry.diff).map(([field, [before, after]]) => (
                          <li key={field} className="font-mono">
                            <span className="font-semibold">{field}</span>:{' '}
                            <span className="text-red-600 dark:text-red-400 line-through">
                              {JSON.stringify(before)}
                            </span>{' '}
                            → <span className="text-emerald-700">{JSON.stringify(after)}</span>
                          </li>
                        ))}
                      </ul>
                    </Td>
                  </tr>
                ) : null}
              </Fragment>
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
