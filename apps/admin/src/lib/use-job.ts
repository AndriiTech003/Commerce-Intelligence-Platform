'use client';

import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';
import { isJobDone } from './jobs';
import { queryKeys } from './query-keys';
import { useTenantId } from './session';

export { isJobDone, jobProgress } from './jobs';

export function useJob(jobId: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: queryKeys.jobs.detail(tenantId, jobId ?? ''),
    enabled: jobId !== null,
    queryFn: async () => unwrap(await api.GET('/v1/admin/jobs/{id}', { params: { path: { id: jobId! } } })),
    refetchInterval: (query) => (isJobDone(query.state.data) ? false : 1000),
    staleTime: 0,
  });
}
