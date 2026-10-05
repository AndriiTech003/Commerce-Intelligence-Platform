'use client';

import { Button, ErrorNote, Skeleton } from '@cip/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ProfileView } from '@/components/profile-view';
import { SectionBoundary } from '@/components/section-boundary';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const profile = useQuery({
    queryKey: queryKeys.profiles.detail(tenantId, id),
    queryFn: async () => unwrap(await api.GET('/v1/admin/profiles/{id}', { params: { path: { id } } })),
  });
  const customerId = profile.data?.customerId ?? null;
  return (
    <div>
      <PageHeader
        title="Visitor profile"
        description={`Profile ${id}${profile.data?.profileId && profile.data.profileId !== id ? ` → ${profile.data.profileId}` : ''}`}
        actions={
          customerId ? (
            <Link href={`/customers/${customerId}`}>
              <Button variant="secondary">Open customer</Button>
            </Link>
          ) : null
        }
      />
      <ErrorNote error={profile.error} />
      {profile.data ? (
        <SectionBoundary title="Profile">
          <ProfileView profile={profile.data} />
        </SectionBoundary>
      ) : profile.isLoading ? (
        <Skeleton className="h-72" />
      ) : null}
    </div>
  );
}
