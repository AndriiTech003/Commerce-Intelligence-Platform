'use client';

import { Button } from '@cip/ui';

export function LoadMore({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="mt-4 flex justify-center">
      <Button variant="secondary" loading={loading} onClick={onClick} data-testid="load-more">
        Load more
      </Button>
    </div>
  );
}
