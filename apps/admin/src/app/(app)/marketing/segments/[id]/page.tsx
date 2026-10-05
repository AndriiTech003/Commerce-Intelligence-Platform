'use client';

import { EmptyState, ErrorNote, Skeleton } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { SegmentEditor } from '@/components/segment-editor';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

export default function SegmentPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const segments = useQuery({
    queryKey: queryKeys.segments.list(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/segments')),
  });
  const segment = segments.data?.data.find((s) => s.id === id);
  if (segments.error) return <ErrorNote error={segments.error} />;
  if (segments.isLoading) return <Skeleton className="h-96" />;
  if (!segment) return <EmptyState title="Segment not found" description="It may have been deleted." />;
  return (
    <div>
      <PageHeader title={segment.name} description={`Segment ${segment.key} · ${segment.members} members`} />
      <SegmentEditor key={segment.id} segment={segment} />
    </div>
  );
}
