import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTracker, uuidv7, type TrackerEnv } from '../../src';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

function makeEnv(overrides: Partial<TrackerEnv> = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  const cookies = new Map<string, string>();
  const doc = {
    referrer: '',
    title: 'Home',
    visibilityState: 'visible',
    addEventListener(type: string, cb: () => void) {
      (listeners[type] ??= []).push(cb);
    },
  };
  const storage = new MemoryStorage();
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ accepted: 1, rejected: [] }), { status: 202 }),
  );
  const beacon = vi.fn((_url: string, _body: string) => true);
  const env: TrackerEnv = {
    fetch: fetchMock as unknown as typeof fetch,
    beacon,
    storage,
    getCookie: (name) => cookies.get(name) ?? null,
    setCookie: (name, value) => cookies.set(name, value),
    location: {
      href: 'https://runhub.localhost/?utm_source=news',
      pathname: '/',
      search: '?utm_source=news',
    },
    doc,
    locale: 'en-US',
    now: () => Date.now(),
    ...overrides,
  };
  return {
    env,
    fetchMock,
    beacon,
    storage,
    cookies,
    hide() {
      doc.visibilityState = 'hidden';
      for (const cb of listeners.visibilitychange ?? []) cb();
    },
  };
}

function sentEvents(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call]![1] as RequestInit;
  return JSON.parse(String(init.body)).events as Array<Record<string, unknown>>;
}

describe('tracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('generates sortable UUIDv7 ids', () => {
    const a = uuidv7(1_700_000_000_000, Math.random);
    const b = uuidv7(1_700_000_000_001, Math.random);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('batches 20 events into one request with the key header', async () => {
    const { env, fetchMock } = makeEnv();
    const tracker = createTracker({ key: 'pk_live_x', endpoint: 'http://collector', env });
    for (let i = 0; i < 19; i++) tracker.track('page_viewed', { page_type: 'home' });
    expect(fetchMock).not.toHaveBeenCalled();
    tracker.track('page_viewed', { page_type: 'home' });
    await vi.runOnlyPendingTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://collector/v1/events');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('pk_live_x');
    const events = sentEvents(fetchMock);
    expect(events).toHaveLength(20);
    expect(new Set(events.map((e) => e.event_id)).size).toBe(20);
    expect((events[0]!.context as { campaign: unknown }).campaign).toEqual({ utm_source: 'news' });
    tracker.shutdown();
  });

  it('flushes on the 5 second interval', async () => {
    const { env, fetchMock } = makeEnv();
    const tracker = createTracker({ key: 'pk_live_x', endpoint: 'http://collector', env });
    tracker.track('product_viewed', { product_id: 'p' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tracker.pending).toBe(0);
    tracker.shutdown();
  });

  it('uses sendBeacon when the page is hidden', () => {
    const { env, beacon, fetchMock, hide } = makeEnv();
    const tracker = createTracker({ key: 'pk_live_k', endpoint: 'http://collector', env });
    tracker.track('cart_item_added', { product_id: 'p' });
    hide();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]![0]).toBe('http://collector/v1/events?key=pk_live_k');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tracker.pending).toBe(0);
    tracker.shutdown();
  });

  it('keeps a localStorage backup and restores it after reload', () => {
    const shared = makeEnv();
    const first = createTracker({ key: 'pk', endpoint: 'http://c', env: shared.env });
    first.track('search_performed', { query: 'shoes', results_count: 3 });
    first.shutdown();
    expect(JSON.parse(shared.storage.getItem('cip_q')!)).toHaveLength(1);
    const second = createTracker({ key: 'pk', endpoint: 'http://c', env: shared.env });
    expect(second.pending).toBe(1);
    expect(second.anonymousId).toBe(first.anonymousId);
    second.shutdown();
  });

  it('respects Retry-After and retries the same event ids', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('', { status: 503, headers: { 'retry-after': '10' } })
        : new Response('{}', { status: 202 });
    });
    const { env } = makeEnv({ fetch: fetchMock as unknown as typeof fetch });
    const tracker = createTracker({ key: 'pk', endpoint: 'http://c', env });
    tracker.track('page_viewed', { page_type: 'home' });
    await vi.advanceTimersByTimeAsync(5001);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentEvents(fetchMock, 1)[0]!.event_id).toBe(sentEvents(fetchMock, 0)[0]!.event_id);
    expect(tracker.pending).toBe(0);
    tracker.shutdown();
  });

  it('backs off exponentially on network errors', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const { env } = makeEnv({ fetch: fetchMock as unknown as typeof fetch, random: () => 0.5 });
    const tracker = createTracker({ key: 'pk', endpoint: 'http://c', env, flushInterval: 100 });
    tracker.track('page_viewed', { page_type: 'home' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(fetchMock.mock.calls.length).toBeLessThan(10);
    expect(tracker.pending).toBe(1);
    tracker.shutdown();
  });

  it('does nothing without consent or with Do Not Track', async () => {
    const dnt = makeEnv({ dnt: true });
    const tracker = createTracker({ key: 'pk', endpoint: 'http://c', env: dnt.env });
    expect(tracker.track('page_viewed', { page_type: 'home' })).toBeNull();
    const noConsent = makeEnv();
    const other = createTracker({ key: 'pk', endpoint: 'http://c', env: noConsent.env, consent: false });
    other.track('page_viewed', {});
    expect(other.pending).toBe(0);
    other.setConsent(true);
    other.track('page_viewed', {});
    expect(other.pending).toBe(1);
    other.setConsent(false);
    expect(other.pending).toBe(0);
    expect(noConsent.storage.getItem('cip_q')).toBeNull();
    tracker.shutdown();
    other.shutdown();
  });

  it('rotates the session after 30 minutes of inactivity and identifies customers', () => {
    let now = 1_700_000_000_000;
    const { env } = makeEnv({ now: () => now });
    const tracker = createTracker({ key: 'pk', endpoint: 'http://c', env });
    const a = tracker.track('page_viewed', {})!;
    now += 10 * 60_000;
    const b = tracker.track('page_viewed', {})!;
    now += 31 * 60_000;
    tracker.identify('0190a000-0000-7000-8000-000000000009');
    const c = tracker.track('page_viewed', {})!;
    expect(a.session_id).toBe(b.session_id);
    expect(c.session_id).not.toBe(b.session_id);
    expect(c.customer_id).toBe('0190a000-0000-7000-8000-000000000009');
    tracker.shutdown();
  });
});
