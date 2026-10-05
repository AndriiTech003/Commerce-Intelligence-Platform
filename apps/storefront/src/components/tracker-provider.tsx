'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createTracker, type Props, type Tracker } from '@ashamrai/cip-tracker';
import { readConsent } from '@/lib/consent';

export interface TrackerApi {
  track: (type: string, props?: Props) => void;
  identify: (customerId: string | undefined) => void;
  setConsent: (granted: boolean) => void;
  flush: () => void;
}

const noop: TrackerApi = {
  track: () => undefined,
  identify: () => undefined,
  setConsent: () => undefined,
  flush: () => undefined,
};

const TrackerContext = createContext<TrackerApi>(noop);

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function TrackerProvider({
  trackingKey,
  collectorUrl,
  children,
}: {
  trackingKey: string | null;
  collectorUrl: string;
  children: ReactNode;
}) {
  const trackerRef = useRef<Tracker | null>(null);
  const customerRef = useRef<string | undefined>(undefined);

  const ensure = useCallback((): Tracker | null => {
    if (typeof window === 'undefined' || !trackingKey) return null;
    if (!trackerRef.current) {
      trackerRef.current = createTracker({
        key: trackingKey,
        endpoint: collectorUrl,
        consent: readConsent(localStore()) === 'granted',
      });
      trackerRef.current.identify(customerRef.current);
    }
    return trackerRef.current;
  }, [trackingKey, collectorUrl]);

  useEffect(() => {
    ensure();
    return () => {
      const tracker = trackerRef.current;
      if (tracker) {
        void tracker.flush(true);
        tracker.shutdown();
      }
      trackerRef.current = null;
    };
  }, [ensure]);

  const value = useMemo<TrackerApi>(
    () => ({
      track: (type, props = {}) => {
        ensure()?.track(type, props);
      },
      identify: (customerId) => {
        customerRef.current = customerId;
        ensure()?.identify(customerId);
      },
      setConsent: (granted) => {
        const tracker = ensure();
        tracker?.setConsent(granted);
        if (granted) void tracker?.flush();
      },
      flush: () => {
        void ensure()
          ?.flush()
          .catch(() => undefined);
      },
    }),
    [ensure],
  );

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}

export function useTracker(): TrackerApi {
  return useContext(TrackerContext);
}
