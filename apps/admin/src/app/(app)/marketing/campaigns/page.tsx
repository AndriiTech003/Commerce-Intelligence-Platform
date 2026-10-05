'use client';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  formatDateTime,
  Input,
  Skeleton,
  statusTone,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLACEMENT_INFO } from '@/components/product-selector';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { statusCounts } from '@/lib/creatives';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function DecisionLookup() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const id = value.trim();
  return (
    <Card className="mt-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (UUID.test(id)) router.push(`/marketing/decisions/${id}`);
        }}
      >
        <div className="min-w-[18rem] flex-1">
          <label htmlFor="decision-id" className="mb-1 block text-sm font-medium">
            Why this ad? Look up a decision
          </label>
          <Input
            id="decision-id"
            placeholder="decision id (uuid) from the storefront or an order attribution"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono text-xs"
            data-testid="decision-lookup"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!UUID.test(id)}>
          Explain
        </Button>
      </form>
    </Card>
  );
}

export default function CampaignsPage() {
  const tenantId = useTenantId();
  const campaigns = useQuery({
    queryKey: queryKeys.campaigns.list(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/campaigns')),
  });
  const rows = campaigns.data?.data ?? [];
  const newButton = (
    <Link href="/marketing/campaigns/new">
      <Button data-testid="new-campaign">New campaign</Button>
    </Link>
  );
  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Each campaign fills one storefront placement. Creatives compete per segment via Thompson sampling."
        actions={newButton}
      />
      <ErrorNote error={campaigns.error} />
      {campaigns.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Pick a placement, choose products and segments, then let the LLM draft creatives for review."
          action={newButton}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Campaign</Th>
              <Th>Status</Th>
              <Th>Placement</Th>
              <Th>Goal</Th>
              <Th>Segments</Th>
              <Th>Creatives</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((c) => (
              <tr key={c.id} data-testid="campaign-row">
                <Td>
                  <Link href={`/marketing/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                </Td>
                <Td>{PLACEMENT_INFO[c.placement].label}</Td>
                <Td>{c.goal}</Td>
                <Td className="max-w-xs text-xs">
                  {c.targetSegments.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {c.targetSegments.map((s) => (
                        <code key={s} className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                          {s}
                        </code>
                      ))}
                    </span>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">everyone (_default)</span>
                  )}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {statusCounts(c.creativeCounts).length === 0 ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">none</span>
                    ) : (
                      statusCounts(c.creativeCounts).map(([status, n]) => (
                        <Badge key={status} tone={statusTone(status)}>
                          {n} {status}
                        </Badge>
                      ))
                    )}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(c.createdAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <DecisionLookup />
    </div>
  );
}
