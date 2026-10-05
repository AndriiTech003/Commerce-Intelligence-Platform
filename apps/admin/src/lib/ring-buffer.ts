export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  replace(items: T[]): void {
    this.items = items.slice(-this.capacity);
  }

  toArray(): T[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }
}

export function upsertPoint(
  buffer: RingBuffer<{ ts: number; value: number }>,
  point: { ts: number; value: number },
): void {
  const items = buffer.toArray();
  const index = items.findIndex((p) => p.ts === point.ts);
  if (index >= 0) {
    items[index] = point;
    buffer.replace(items);
    return;
  }
  items.push(point);
  items.sort((a, b) => a.ts - b.ts);
  buffer.replace(items);
}
