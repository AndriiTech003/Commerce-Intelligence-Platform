'use client';

import { Badge, Button, EmptyState, ErrorNote, formatNumber, Skeleton, Table, Td, Th } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';

export default function SegmentsPage() {
  const tenantId = useTenantId();
  const { can } = useSession();
  const segments = useQuery({
    queryKey: queryKeys.segments.list(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/segments')),
  });
  const rows = [...(segments.data?.data ?? [])].sort(
    (a, b) => a.priority - b.priority || a.key.localeCompare(b.key),
  );
  const newButton = can('marketing:write') ? (
    <Link href="/marketing/segments/new">
      <Button data-testid="new-segment">New segment</Button>
    </Link>
  ) : null;
  return (
    <div>
      <PageHeader
        title="Segments"
        description="Rule-based audiences evaluated in memory against each profile. The lowest priority among a campaign's targets decides which bandit a shopper feeds."
        actions={newButton}
      />
      <ErrorNote error={segments.error} />
      {segments.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No segments yet"
          description="System segments are created with the store; add your own audiences with the rule builder."
          action={newButton}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Key</Th>
              <Th>Name</Th>
              <Th className="text-right">Priority</Th>
              <Th className="text-right">Members</Th>
              <Th>Rules</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((s) => (
              <tr key={s.id} data-testid="segment-row" data-key={s.key}>
                <Td>
                  <Link
                    href={`/marketing/segments/${s.id}`}
                    className="font-mono text-xs font-medium hover:underline"
                  >
                    {s.key}
                  </Link>
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    {s.name}
                    {s.isSystem ? <Badge tone="blue">system</Badge> : null}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">{s.priority}</Td>
                <Td className="text-right tabular-nums">{formatNumber(s.members)}</Td>
                <Td className="max-w-md font-mono text-xs text-slate-600 dark:text-slate-300">
                  {s.description}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
