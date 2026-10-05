import type { ConsumeMessage } from 'amqplib';
import {
  EXCHANGES,
  MESSAGE_HEADERS,
  RETRY_DELAYS,
  queueName,
  retryQueueName,
  type RetryDelay,
} from '@cip/contracts';
import type { Publisher } from './publisher';
import type { ErrorKind } from './errors';

export function retryCountOf(message: ConsumeMessage): number {
  const value = message.properties.headers?.[MESSAGE_HEADERS.retryCount];
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function messageIdOf(message: ConsumeMessage): string {
  const id = message.properties.messageId as string | undefined;
  if (id) return id;
  return `${message.fields.exchange}:${message.fields.routingKey}:${message.content.toString('base64').slice(0, 64)}`;
}

export type FailureOutcome = 'retry' | 'dlq';

export async function routeFailure(
  publisher: Publisher,
  message: ConsumeMessage,
  logicalQueue: string,
  kind: ErrorKind,
  error: unknown,
  delays: readonly RetryDelay[] = RETRY_DELAYS,
): Promise<FailureOutcome> {
  const retryCount = retryCountOf(message);
  const headers: Record<string, unknown> = { ...(message.properties.headers ?? {}) };
  const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  headers[MESSAGE_HEADERS.error] = errorText.slice(0, 1000);
  headers[MESSAGE_HEADERS.errorKind] = kind;
  headers[MESSAGE_HEADERS.originalQueue] = queueName(logicalQueue);
  headers['x-original-exchange'] = headers['x-original-exchange'] ?? message.fields.exchange;
  headers['x-original-routing-key'] = headers['x-original-routing-key'] ?? message.fields.routingKey;
  const messageId = messageIdOf(message);
  if (kind === 'retryable' && retryCount < delays.length) {
    const delay = delays[retryCount]!;
    headers[MESSAGE_HEADERS.retryCount] = retryCount + 1;
    await publisher.publish({
      exchange: EXCHANGES.retry,
      routingKey: retryQueueName(logicalQueue, delay),
      body: message.content,
      messageId,
      headers,
      contentType: message.properties.contentType as string | undefined,
    });
    return 'retry';
  }
  headers[MESSAGE_HEADERS.failedAt] = new Date().toISOString();
  await publisher.publish({
    exchange: EXCHANGES.dlx,
    routingKey: logicalQueue,
    body: message.content,
    messageId,
    headers,
    contentType: message.properties.contentType as string | undefined,
  });
  return 'dlq';
}
