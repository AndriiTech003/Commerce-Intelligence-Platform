import type { ConfirmChannel, Message, Options } from 'amqplib';
import { counter, injectTraceContext } from '@cip/observability';
import type { AmqpClient } from './connection';
import { BrokerUnavailableError, UnroutableMessageError } from './errors';

export interface OutgoingMessage {
  exchange: string;
  routingKey: string;
  body: unknown;
  messageId: string;
  headers?: Record<string, unknown>;
  timestamp?: number;
  contentType?: string;
}

export class Publisher {
  private channel: ConfirmChannel | null = null;
  private readonly returned = new Set<string>();
  private readonly published = counter('messages_published_total', 'Messages published', [
    'exchange',
    'outcome',
  ]);

  constructor(private readonly client: AmqpClient) {
    client.onConnect(async (model) => {
      const channel = await model.createConfirmChannel();
      channel.on('return', (message: Message) => {
        const id = message.properties.messageId as string | undefined;
        if (id) this.returned.add(id);
      });
      channel.on('error', () => undefined);
      channel.on('close', () => {
        if (this.channel === channel) this.channel = null;
      });
      this.channel = channel;
    });
  }

  get ready(): boolean {
    return this.channel !== null;
  }

  publish(message: OutgoingMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) {
      this.published.inc({ exchange: message.exchange, outcome: 'unavailable' });
      return Promise.reject(new BrokerUnavailableError());
    }
    const content = Buffer.isBuffer(message.body) ? message.body : Buffer.from(JSON.stringify(message.body));
    const headers = injectTraceContext({ ...(message.headers ?? {}) });
    const options: Options.Publish = {
      persistent: true,
      mandatory: true,
      messageId: message.messageId,
      contentType: message.contentType ?? 'application/json',
      timestamp: Math.floor((message.timestamp ?? Date.now()) / 1000),
      headers,
    };
    return new Promise<void>((resolve, reject) => {
      try {
        channel.publish(message.exchange, message.routingKey, content, options, (error: unknown) => {
          if (error) {
            this.published.inc({ exchange: message.exchange, outcome: 'nack' });
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          if (this.returned.delete(message.messageId)) {
            this.published.inc({ exchange: message.exchange, outcome: 'returned' });
            reject(new UnroutableMessageError(message.exchange, message.routingKey));
            return;
          }
          this.published.inc({ exchange: message.exchange, outcome: 'ack' });
          resolve();
        });
      } catch (error) {
        this.published.inc({ exchange: message.exchange, outcome: 'error' });
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async publishMany(messages: OutgoingMessage[]): Promise<Array<{ ok: true } | { ok: false; error: Error }>> {
    const results = await Promise.allSettled(messages.map((m) => this.publish(m)));
    return results.map((r) =>
      r.status === 'fulfilled' ? { ok: true as const } : { ok: false as const, error: r.reason as Error },
    );
  }
}
