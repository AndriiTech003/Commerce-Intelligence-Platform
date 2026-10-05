export class ThrottleQueue<T> {
  private queue: T[] = [];
  private last = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly maxQueue = 50,
  ) {}

  enqueue(item: T): void {
    this.queue.push(item);
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
  }

  take(now: number): T | null {
    if (this.queue.length === 0 || now - this.last < this.intervalMs) return null;
    this.last = now;
    return this.queue.shift() ?? null;
  }

  get size(): number {
    return this.queue.length;
  }
}
