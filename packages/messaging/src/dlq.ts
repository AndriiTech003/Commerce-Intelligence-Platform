import type { ChannelModel, GetMessage } from 'amqplib';
import { dlqNames, logicalNameFromDlq, MESSAGE_HEADERS, queueName } from '@cip/contracts';
import { messageIdOf } from './failure';
import type { Publisher } from './publisher';

export interface DlqSummary {
  queue: string;
  source: string;
  messages: number;
}

export interface DlqMessage {
  messageId: string;
  routingKey: string;
  exchange: string;
  headers: Record<string, unknown>;
  error: string | null;
  retryCount: number;
  body: unknown;
}

function decode(message: GetMessage): DlqMessage {
  const headers = { ...(message.properties.headers ?? {}) } as Record<string, unknown>;
  let body: unknown;
  try {
    body = JSON.parse(message.content.toString('utf8'));
  } catch {
    body = message.content.toString('utf8');
  }
  return {
    messageId: messageIdOf(message as never),
    routingKey: String(headers['x-original-routing-key'] ?? message.fields.routingKey),
    exchange: String(headers['x-original-exchange'] ?? message.fields.exchange),
    headers,
    error:
      typeof headers[MESSAGE_HEADERS.error] === 'string' ? (headers[MESSAGE_HEADERS.error] as string) : null,
    retryCount: Number(headers[MESSAGE_HEADERS.retryCount] ?? 0),
    body,
  };
}

export class DlqAdmin {
  constructor(
    private readonly model: () => ChannelModel | null,
    private readonly publisher: Publisher,
  ) {}

  private connection(): ChannelModel {
    const model = this.model();
    if (!model) throw new Error('RabbitMQ is not connected');
    return model;
  }

  async list(): Promise<DlqSummary[]> {
    const channel = await this.connection().createChannel();
    channel.on('error', () => undefined);
    try {
      const out: DlqSummary[] = [];
      for (const queue of dlqNames()) {
        const info = await channel.checkQueue(queue);
        out.push({ queue, source: queueName(logicalNameFromDlq(queue) ?? ''), messages: info.messageCount });
      }
      return out;
    } finally {
      await channel.close().catch(() => undefined);
    }
  }

  async peek(queue: string, limit: number): Promise<DlqMessage[]> {
    if (!logicalNameFromDlq(queue)) throw new Error(`unknown DLQ ${queue}`);
    const channel = await this.connection().createChannel();
    channel.on('error', () => undefined);
    try {
      const out: DlqMessage[] = [];
      for (let i = 0; i < limit; i++) {
        const message = await channel.get(queue, { noAck: false });
        if (!message) break;
        out.push(decode(message));
      }
      return out;
    } finally {
      await channel.close().catch(() => undefined);
    }
  }

  async replay(queue: string, ids: string[] | 'all'): Promise<{ replayed: number; remaining: number }> {
    const logical = logicalNameFromDlq(queue);
    if (!logical) throw new Error(`unknown DLQ ${queue}`);
    const wanted = ids === 'all' ? null : new Set(ids);
    const channel = await this.connection().createChannel();
    channel.on('error', () => undefined);
    let replayed = 0;
    const kept: GetMessage[] = [];
    try {
      const { messageCount } = await channel.checkQueue(queue);
      for (let i = 0; i < messageCount; i++) {
        const message = await channel.get(queue, { noAck: false });
        if (!message) break;
        const decoded = decode(message);
        if (wanted && !wanted.has(decoded.messageId)) {
          kept.push(message);
          continue;
        }
        const headers: Record<string, unknown> = {
          ...decoded.headers,
          'x-replayed-at': new Date().toISOString(),
        };
        headers[MESSAGE_HEADERS.retryCount] = 0;
        delete headers[MESSAGE_HEADERS.error];
        delete headers[MESSAGE_HEADERS.errorKind];
        await this.publisher.publish({
          exchange: '',
          routingKey: queueName(logical),
          body: message.content,
          messageId: decoded.messageId,
          headers,
          contentType: message.properties.contentType as string | undefined,
        });
        channel.ack(message);
        replayed += 1;
      }
      for (const message of kept) channel.nack(message, false, true);
      await channel.close();
      const verify = await this.connection().createChannel();
      verify.on('error', () => undefined);
      let remaining = 0;
      for (let attempt = 0; attempt < 20; attempt++) {
        remaining = (await verify.checkQueue(queue)).messageCount;
        if (remaining >= kept.length) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await verify.close().catch(() => undefined);
      return { replayed, remaining };
    } catch (error) {
      await channel.close().catch(() => undefined);
      throw error;
    }
  }
}
