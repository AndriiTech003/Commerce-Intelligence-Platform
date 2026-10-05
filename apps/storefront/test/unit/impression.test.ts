import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMPRESSION_DWELL_MS,
  createImpressionTimer,
  createOnceRegistry,
  initialImpressionState,
  transition,
} from '@/lib/impression';

describe('impression transition', () => {
  it('starts counting at 50% and stays waiting at 49%', () => {
    const start = initialImpressionState();
    expect(transition(start, { type: 'ratio', ratio: 0.5 }).phase).toBe('counting');
    expect(transition(start, { type: 'ratio', ratio: 0.49 }).phase).toBe('waiting');
  });

  it('only fires on elapsed while still qualifying', () => {
    const counting = transition(initialImpressionState(), { type: 'ratio', ratio: 0.8 });
    expect(transition(counting, { type: 'elapsed' }).phase).toBe('fired');
    const waiting = transition(counting, { type: 'ratio', ratio: 0.2 });
    expect(transition(waiting, { type: 'elapsed' }).phase).toBe('waiting');
  });

  it('treats a hidden page as not visible and fired as terminal', () => {
    const hidden = transition(initialImpressionState(false), { type: 'ratio', ratio: 1 });
    expect(hidden.phase).toBe('waiting');
    const fired = { ...hidden, phase: 'fired' as const };
    expect(transition(fired, { type: 'ratio', ratio: 0 })).toBe(fired);
  });
});

describe('impression timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after 1s at >= 50% visibility', () => {
    const onImpression = vi.fn();
    const timer = createImpressionTimer({ onImpression });
    timer.setRatio(0.5);
    vi.advanceTimersByTime(IMPRESSION_DWELL_MS - 1);
    expect(onImpression).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onImpression).toHaveBeenCalledTimes(1);
    expect(timer.state.phase).toBe('fired');
  });

  it('does not fire at 49% no matter how long', () => {
    const onImpression = vi.fn();
    const timer = createImpressionTimer({ onImpression });
    timer.setRatio(0.49);
    vi.advanceTimersByTime(10 * IMPRESSION_DWELL_MS);
    expect(onImpression).not.toHaveBeenCalled();
    expect(timer.state.phase).toBe('waiting');
  });

  it('resets the timer when the block scrolls away', () => {
    const onImpression = vi.fn();
    const timer = createImpressionTimer({ onImpression });
    timer.setRatio(0.9);
    vi.advanceTimersByTime(800);
    timer.setRatio(0.3);
    vi.advanceTimersByTime(800);
    timer.setRatio(0.6);
    vi.advanceTimersByTime(800);
    expect(onImpression).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onImpression).toHaveBeenCalledTimes(1);
  });

  it('keeps counting while the ratio changes but stays above the threshold', () => {
    const onImpression = vi.fn();
    const timer = createImpressionTimer({ onImpression });
    timer.setRatio(0.55);
    vi.advanceTimersByTime(500);
    timer.setRatio(1);
    vi.advanceTimersByTime(500);
    expect(onImpression).toHaveBeenCalledTimes(1);
  });

  it('fires only once', () => {
    const onImpression = vi.fn();
    const timer = createImpressionTimer({ onImpression });
    timer.setRatio(1);
    vi.advanceTimersByTime(IMPRESSION_DWELL_MS);
    timer.setRatio(0);
    timer.setRatio(1);
    vi.advanceTimersByTime(5 * IMPRESSION_DWELL_MS);
    timer.setPageVisible(false);
    timer.setPageVisible(true);
    vi.advanceTimersByTime(5 * IMPRESSION_DWELL_MS);
    expect(onImpression).toHaveBeenCalledTimes(1);
  });

  it('does not count time while the tab is hidden', () => {
    const onImpression = vi.fn();
    const timer = createImpressionTimer({ onImpression, pageVisible: false });
    timer.setRatio(1);
    vi.advanceTimersByTime(5 * IMPRESSION_DWELL_MS);
    expect(onImpression).not.toHaveBeenCalled();
    timer.setPageVisible(true);
    vi.advanceTimersByTime(600);
    timer.setPageVisible(false);
    vi.advanceTimersByTime(5 * IMPRESSION_DWELL_MS);
    expect(onImpression).not.toHaveBeenCalled();
    timer.setPageVisible(true);
    vi.advanceTimersByTime(999);
    expect(onImpression).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onImpression).toHaveBeenCalledTimes(1);
  });

  it('never fires after dispose', () => {
    const onImpression = vi.fn();
    const timer = createImpressionTimer({ onImpression });
    timer.setRatio(1);
    vi.advanceTimersByTime(500);
    timer.dispose();
    vi.advanceTimersByTime(5 * IMPRESSION_DWELL_MS);
    timer.setRatio(1);
    vi.advanceTimersByTime(5 * IMPRESSION_DWELL_MS);
    expect(onImpression).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('once registry', () => {
  it('claims each decision id once', () => {
    const registry = createOnceRegistry(2);
    expect(registry.claim('a')).toBe(true);
    expect(registry.claim('a')).toBe(false);
    expect(registry.has('a')).toBe(true);
    expect(registry.claim('b')).toBe(true);
    expect(registry.claim('c')).toBe(true);
    expect(registry.has('a')).toBe(false);
    expect(registry.has('c')).toBe(true);
  });
});
