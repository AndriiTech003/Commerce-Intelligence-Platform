'use client';

import { Button } from '@cip/ui';

export default function StoreError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">The store is temporarily unavailable</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">Please try again in a moment.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
