import type { OutgoingMessage } from '@cip/messaging';
import { gauge, type Logger } from '@cip/observability';

export interface PublishPort {
  readonly ready: boolean;
  publishMany(messages: OutgoingMessage[]): Promise<Array<{ ok: true } | { ok: false; error: Error }>>;
}

export type SubmitResult = 'published' | 'buffered' | 'overflow';

export class PublishBuffer {
  private queue: OutgoingMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private readonly size = gauge(
    'collector_buffer_size',
    'Events buffered in memory while the broker is unavailable',
  );

  constructor(
    private readonly publisher: PublishPort,
    private readonly max: number,
    private readonly logger?: Logger,
    private readonly intervalMs = 250,
  ) {}

  get length(): number {
    return this.queue.length;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.drain(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async submit(messages: OutgoingMessage[]): Promise<SubmitResult> {
    if (messages.length === 0) return 'published';
    if (!this.publisher.ready || this.queue.length > 0) {
      if (this.queue.length + messages.length > this.max) return 'overflow';
      this.queue.push(...messages);
      this.size.set(this.queue.length);
      return 'buffered';
    }
    const results = await this.publisher.publishMany(messages);
    const failed = messages.filter((_, i) => !results[i]!.ok);
    if (failed.length === 0) return 'published';
    if (this.queue.length + failed.length > this.max) {
      this.logger?.error({ dropped: failed.length }, 'buffer overflow while publishing');
      return 'overflow';
    }
    this.queue.push(...failed);
    this.size.set(this.queue.length);
    return 'buffered';
  }

  async drain(): Promise<number> {
    if (this.draining || this.queue.length === 0 || !this.publisher.ready) return 0;
    this.draining = true;
    let published = 0;
    try {
      while (this.queue.length > 0 && this.publisher.ready) {
        const batch = this.queue.slice(0, 500);
        const results = await this.publisher.publishMany(batch);
        const failed = batch.filter((_, i) => !results[i]!.ok);
        published += batch.length - failed.length;
        this.queue = [...failed, ...this.queue.slice(batch.length)];
        if (failed.length > 0) break;
      }
    } finally {
      this.size.set(this.queue.length);
      this.draining = false;
    }
    return published;
  }
}
