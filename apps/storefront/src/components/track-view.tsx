'use client';

import { useEffect, useRef } from 'react';
import type { Props } from '@ashamrai/cip-tracker';
import { useTracker } from './tracker-provider';

export interface ViewEvent {
  type: string;
  props: Props;
}

export function TrackView({ events }: { events: ViewEvent[] }) {
  const tracker = useTracker();
  const signature = JSON.stringify(events);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === signature) return;
    sent.current = signature;
    for (const event of JSON.parse(signature) as ViewEvent[]) tracker.track(event.type, event.props);
  }, [tracker, signature]);
  return null;
}
