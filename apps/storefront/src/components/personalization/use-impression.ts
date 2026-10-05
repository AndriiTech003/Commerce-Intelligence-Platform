'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { IMPRESSION_THRESHOLDS, createImpressionTimer, impressionRegistry } from '@/lib/impression';

export function useImpression(
  ref: RefObject<Element | null>,
  key: string | null | undefined,
  onImpression: () => void,
): void {
  const callback = useRef(onImpression);
  useEffect(() => {
    callback.current = onImpression;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element || !key || impressionRegistry.has(key)) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const pageVisible = () => document.visibilityState !== 'hidden';
    const timer = createImpressionTimer({
      pageVisible: pageVisible(),
      onImpression: () => {
        if (impressionRegistry.claim(key)) callback.current();
      },
    });
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) timer.setRatio(entry.isIntersecting ? entry.intersectionRatio : 0);
      },
      { threshold: IMPRESSION_THRESHOLDS },
    );
    const onVisibility = () => timer.setPageVisible(pageVisible());
    observer.observe(element);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      timer.dispose();
    };
  }, [ref, key]);
}
