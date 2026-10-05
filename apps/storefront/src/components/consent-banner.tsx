'use client';

import { useEffect, useState } from 'react';
import { Button } from '@cip/ui';
import { readConsent, writeConsent, type ConsentChoice } from '@/lib/consent';
import { useTracker } from './tracker-provider';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  const tracker = useTracker();

  useEffect(() => {
    setOpen(readConsent(storage()) === null);
  }, []);

  if (!open) return null;

  const choose = (choice: ConsentChoice) => {
    writeConsent(storage(), choice);
    tracker.setConsent(choice === 'granted');
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          We use first-party analytics to improve the store and personalise recommendations. No tracking
          happens until you choose.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" data-testid="consent-decline" onClick={() => choose('denied')}>
            Decline
          </Button>
          <Button data-testid="consent-accept" onClick={() => choose('granted')}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
