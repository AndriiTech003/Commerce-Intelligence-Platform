export const IMPRESSION_MIN_RATIO = 0.5;
export const IMPRESSION_DWELL_MS = 1000;
export const IMPRESSION_THRESHOLDS = [0, 0.25, 0.49, 0.5, 0.51, 0.75, 1];

const RATIO_TOLERANCE = 0.001;

export type ImpressionPhase = 'waiting' | 'counting' | 'fired';

export interface ImpressionState {
  phase: ImpressionPhase;
  ratio: number;
  pageVisible: boolean;
}

export type ImpressionEvent =
  { type: 'ratio'; ratio: number } | { type: 'page'; visible: boolean } | { type: 'elapsed' };

export function initialImpressionState(pageVisible = true): ImpressionState {
  return { phase: 'waiting', ratio: 0, pageVisible };
}

export function isQualifying(
  state: Pick<ImpressionState, 'ratio' | 'pageVisible'>,
  minRatio: number,
): boolean {
  return state.pageVisible && state.ratio + RATIO_TOLERANCE >= minRatio;
}

export function transition(
  state: ImpressionState,
  event: ImpressionEvent,
  minRatio = IMPRESSION_MIN_RATIO,
): ImpressionState {
  if (state.phase === 'fired') return state;
  if (event.type === 'elapsed') {
    return state.phase === 'counting' && isQualifying(state, minRatio) ? { ...state, phase: 'fired' } : state;
  }
  const next =
    event.type === 'ratio'
      ? { ...state, ratio: Math.max(0, Math.min(1, event.ratio)) }
      : { ...state, pageVisible: event.visible };
  return { ...next, phase: isQualifying(next, minRatio) ? 'counting' : 'waiting' };
}

export interface ImpressionTimerOptions {
  onImpression: () => void;
  minRatio?: number;
  dwellMs?: number;
  pageVisible?: boolean;
}

export interface ImpressionTimer {
  readonly state: ImpressionState;
  setRatio: (ratio: number) => void;
  setPageVisible: (visible: boolean) => void;
  dispose: () => void;
}

export function createImpressionTimer(options: ImpressionTimerOptions): ImpressionTimer {
  const minRatio = options.minRatio ?? IMPRESSION_MIN_RATIO;
  const dwellMs = options.dwellMs ?? IMPRESSION_DWELL_MS;
  let state = initialImpressionState(options.pageVisible ?? true);
  let handle: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const cancel = () => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
  };

  const dispatch = (event: ImpressionEvent) => {
    if (disposed) return;
    const previous = state;
    state = transition(previous, event, minRatio);
    if (state.phase !== 'counting') cancel();
    else if (previous.phase !== 'counting') {
      handle = setTimeout(() => {
        handle = null;
        dispatch({ type: 'elapsed' });
      }, dwellMs);
    }
    if (state.phase === 'fired' && previous.phase !== 'fired') options.onImpression();
  };

  return {
    get state() {
      return state;
    },
    setRatio: (ratio) => dispatch({ type: 'ratio', ratio }),
    setPageVisible: (visible) => dispatch({ type: 'page', visible }),
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}

export interface OnceRegistry {
  has: (key: string) => boolean;
  claim: (key: string) => boolean;
}

export function createOnceRegistry(limit = 500): OnceRegistry {
  const seen = new Set<string>();
  return {
    has: (key) => seen.has(key),
    claim: (key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > limit) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return true;
    },
  };
}

export const impressionRegistry = createOnceRegistry();
