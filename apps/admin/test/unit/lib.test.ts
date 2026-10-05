import { describe, expect, it } from 'vitest';
import { visibleNav } from '../../src/components/nav';
import { backoffDelay } from '../../src/lib/backoff';
import { queryKeys } from '../../src/lib/query-keys';
import { RingBuffer, upsertPoint } from '../../src/lib/ring-buffer';
import { ThrottleQueue } from '../../src/lib/throttle-queue';

describe('ring buffer', () => {
  it('keeps the last N points sorted and upserts by timestamp', () => {
    const buffer = new RingBuffer<{ ts: number; value: number }>(3);
    for (const ts of [1, 2, 3, 4]) upsertPoint(buffer, { ts, value: ts });
    upsertPoint(buffer, { ts: 3, value: 30 });
    expect(buffer.toArray()).toEqual([
      { ts: 2, value: 2 },
      { ts: 3, value: 30 },
      { ts: 4, value: 4 },
    ]);
  });
});

describe('backoff', () => {
  it('grows exponentially with jitter and caps', () => {
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(3, () => 1)).toBe(4000);
    expect(backoffDelay(20, () => 1)).toBe(15000);
  });
});

describe('feed throttling', () => {
  it('releases at most one item per interval', () => {
    const queue = new ThrottleQueue<number>(200);
    queue.enqueue(1);
    queue.enqueue(2);
    expect(queue.take(1000)).toBe(1);
    expect(queue.take(1100)).toBeNull();
    expect(queue.take(1200)).toBe(2);
  });

  it('drops the oldest items when the queue is full', () => {
    const queue = new ThrottleQueue<number>(0, 2);
    [1, 2, 3].forEach((n) => queue.enqueue(n));
    expect(queue.take(1)).toBe(2);
  });
});

describe('navigation', () => {
  it('hides items without permission and platform items for merchants', () => {
    const nav = visibleNav((p) => p === 'orders:read', false);
    const items = nav.flatMap((g) => g.items.map((i) => i.href));
    expect(items).toEqual(['/orders']);
    expect(visibleNav(() => false, true).flatMap((g) => g.items.map((i) => i.href))).toContain(
      '/platform/dlq',
    );
  });

  it('scopes query keys by tenant', () => {
    expect(queryKeys.orders.detail('t1', 'o1')).toEqual(['orders', 't1', 'detail', 'o1']);
  });
});
