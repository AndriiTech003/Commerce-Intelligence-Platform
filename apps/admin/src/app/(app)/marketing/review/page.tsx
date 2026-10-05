'use client';

import { Badge, EmptyState, ErrorNote, Skeleton } from '@cip/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CreativeCard } from '@/components/creative-card';
import { ProblemNote } from '@/components/problem-note';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { blockingFlags, patchReviewQueue, type OptimisticApply } from '@/lib/creatives';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';
import type { ReviewQueue } from '@/lib/types';

export default function ReviewQueuePage() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [reviewError, setReviewError] = useState<unknown>(null);
  const key = queryKeys.creatives.reviewQueue(tenantId);
  const queue = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await api.GET('/v1/admin/creatives/review-queue')),
    refetchInterval: 15_000,
  });
  const optimistic: OptimisticApply = (creativeId, change) => {
    setReviewError(null);
    void queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<ReviewQueue>(key);
    queryClient.setQueryData<ReviewQueue>(key, (old) => patchReviewQueue(old, creativeId, change));
    return () => queryClient.setQueryData(key, previous);
  };
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all(tenantId) });
  };
  const items = queue.data?.data ?? [];
  const flagged = items.filter((i) => i.guardrailFlags.length > 0);
  const blocked = items.filter((i) => blockingFlags(i.guardrailFlags).length > 0);
  const shown = flaggedOnly ? flagged : items;
  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Draft creatives waiting for approval. Only approved creatives enter the bandit."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            Only flagged ({flagged.length})
          </label>
        }
      />
      {items.length > 0 ? (
        <p className="mb-4 flex flex-wrap gap-2 text-sm" data-testid="review-summary">
          <Badge>{items.length} drafts</Badge>
          <Badge tone="yellow">{flagged.length} flagged</Badge>
          <Badge tone="red">{blocked.length} blocked from approval</Badge>
        </p>
      ) : null}
      <ErrorNote error={queue.error} />
      {reviewError ? (
        <div className="mb-4">
          <ProblemNote error={reviewError} testId="review-error" />
        </div>
      ) : null}
      {queue.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'Nothing to review' : 'No flagged drafts'}
          description={
            items.length === 0
              ? 'Generated or hand-written drafts appear here until someone approves them.'
              : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="review-list">
          {[...shown]
            .sort((a, b) => b.guardrailFlags.length - a.guardrailFlags.length)
            .map((item) => (
              <CreativeCard
                key={`${item.id}-${item.headline}`}
                creative={item}
                campaign={{ id: item.campaignId, name: item.campaignName, placement: item.placement }}
                optimistic={optimistic}
                onSettled={settle}
                removeOnReview
                onError={setReviewError}
              />
            ))}
        </div>
      )}
    </div>
  );
}
