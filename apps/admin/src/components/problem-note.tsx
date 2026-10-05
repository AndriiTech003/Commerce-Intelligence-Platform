'use client';

import { ErrorNote } from '@cip/ui';
import { errorMessage, problemDetails } from '@/lib/api';

export function ProblemNote({ error, testId }: { error: unknown; testId?: string }) {
  if (!error) return null;
  const details = problemDetails(error);
  return (
    <div data-testid={testId} className="space-y-1">
      <ErrorNote error={new Error(errorMessage(error))} />
      {details.length > 0 ? (
        <ul className="list-inside list-disc space-y-0.5 pl-1 text-xs text-red-700 dark:text-red-300">
          {details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
