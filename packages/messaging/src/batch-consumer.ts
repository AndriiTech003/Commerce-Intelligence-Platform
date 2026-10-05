import type { Channel, ConsumeMessage } from 'amqplib';
import { queueName, RETRY_DELAYS, type RetryDelay } from '@cip/contracts';
import { counter, histogram, type Logger } from '@cip/observability';
import type { AmqpClient } from './connection';
import { consumerMetrics, contextOf, decodeJson, observeEndToEnd, type MessageContext } from './consumer';
import { routeFailure } from './failure';
import type { Publisher } from './publisher';

export interface BatchItem<T> {
  data: T;
  ctx: MessageContext;
}

export interface BatchConsumeOptions<T> {
  queue: string;
  consumer: string;
  prefetch: number;
  batchSize: number;
  flushIntervalMs: number;
  parse: (raw: unknown) => T;
  handleBatch: (items: BatchItem<T>[]) => Promise<void>;
  retry?: { delays: readonly RetryDelay[] };
  occurredAt?: (item: T) => string | undefined;
}

interface Pending<T> {
  message: ConsumeMessage;
  item: BatchItem<T> | null;
  error: unknown;
}

export class BatchConsumer<T> {
  private channel: Channel | null = null;
  private consumerTag: string | null = null;
  private buffer: Pending<T>[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private stopping = false;
  private readonly metrics = consumerMetrics();
  private readonly batchSizes = histogram(
    'consumer_batch_size',
    'Messages per flushed batch',
    ['queue'],
    [1, 10, 50, 100, 250, 500, 1000, 2000],
  );
  private readonly flushes = counter('consumer_batch_flushes_total', 'Batch flushes', ['queue', 'outcome']);

  constructor(
    private readonly client: AmqpClient,
    private readonly publisher: Publisher,
    private readonly options: BatchConsumeOptions<T>,
    private readonly logger?: Logger,
  ) {}

  start(): void {
    this.client.onConnect(async (model) => {
      if (this.stopping) return;
      const channel = await model.createChannel();
      channel.on('error', (error: Error) => this.logger?.warn({ err: error }, 'batch channel error'));
      channel.on('close', () => {
        if (this.channel === channel) {
          this.channel = null;
          this.consumerTag = null;
          this.buffer = [];
        }
      });
      await channel.checkQueue(queueName(this.options.queue));
      await channel.prefetch(Math.max(this.options.prefetch, this.options.batchSize));
      this.channel = channel;
      const reply = await channel.consume(queueName(this.options.queue), (message) => {
        if (message) this.accept(channel, message);
      });
      this.consumerTag = reply.consumerTag;
    });
  }

  private accept(channel: Channel, message: ConsumeMessage): void {
    if (channel !== this.channel) return;
    let pending: Pending<T>;
    try {
      const data = this.options.parse(decodeJson(message));
      pending = { message, item: { data, ctx: contextOf(message) }, error: null };
    } catch (error) {
      pending = { message, item: null, error };
    }
    this.buffer.push(pending);
    if (this.buffer.length >= this.options.batchSize) this.scheduleFlush(0);
    else if (!this.timer) this.scheduleFlush(this.options.flushIntervalMs);
  }

  private scheduleFlush(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushing = this.flushing.then(() => this.flush()).catch(() => undefined);
    }, delay);
  }

  async flush(): Promise<void> {
    const channel = this.channel;
    if (!channel || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.options.batchSize);
    if (this.buffer.length > 0) this.scheduleFlush(0);
    const queue = queueName(this.options.queue);
    const valid = batch.filter((p) => p.item !== null);
    const poison = batch.filter((p) => p.item === null);
    const last = batch[batch.length - 1]!.message;
    try {
      for (const p of poison) {
        await routeFailure(this.publisher, p.message, this.options.queue, 'poison', p.error);
        this.metrics.consumed.inc({ queue, outcome: 'dlq' });
      }
      if (valid.length > 0) await this.options.handleBatch(valid.map((p) => p.item!));
      channel.ack(last, true);
      this.batchSizes.observe({ queue }, batch.length);
      this.flushes.inc({ queue, outcome: 'ok' });
      this.metrics.consumed.inc({ queue, outcome: 'ack' }, valid.length);
      for (const p of valid) observeEndToEnd(queue, this.options.occurredAt?.(p.item!.data));
    } catch (error) {
      this.flushes.inc({ queue, outcome: 'failed' });
      this.logger?.warn({ err: error, queue, size: batch.length }, 'batch failed, routing to retry');
      try {
        for (const p of valid) {
          const outcome = await routeFailure(
            this.publisher,
            p.message,
            this.options.queue,
            'retryable',
            error,
            this.options.retry?.delays ?? RETRY_DELAYS,
          );
          this.metrics.consumed.inc({ queue, outcome });
        }
        channel.ack(last, true);
      } catch (routeError) {
        this.logger?.error({ err: routeError, queue }, 'could not route failed batch, requeueing');
        try {
          channel.nack(last, true, true);
        } catch {
          return;
        }
      }
    }
  }

  async stop(timeoutMs = 25000): Promise<void> {
    this.stopping = true;
    const channel = this.channel;
    if (channel && this.consumerTag) await channel.cancel(this.consumerTag).catch(() => undefined);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const drain = (async () => {
      await this.flushing;
      while (this.buffer.length > 0 && this.channel) await this.flush();
    })();
    await Promise.race([drain, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]);
    if (channel) await channel.close().catch(() => undefined);
    this.channel = null;
  }
}
