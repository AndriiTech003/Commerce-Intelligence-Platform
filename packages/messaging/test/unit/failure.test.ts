import type { ConsumeMessage } from 'amqplib';
import { describe, expect, it } from 'vitest';
import {
  defaultClassifyError,
  MemoryDeduper,
  PoisonMessageError,
  routeFailure,
  type OutgoingMessage,
  type Publisher,
} from '../../src';

function message(retry: number): ConsumeMessage {
  return {
    content: Buffer.from('{}'),
    fields: {
      deliveryTag: 1,
      redelivered: false,
      exchange: 'domain',
      routingKey: 'order.paid',
      consumerTag: 'c',
    },
    properties: { messageId: 'm1', headers: { 'x-retry-count': retry }, contentType: 'application/json' },
  } as unknown as ConsumeMessage;
}

function fakePublisher() {
  const sent: OutgoingMessage[] = [];
  return {
    sent,
    publisher: { publish: async (m: OutgoingMessage) => void sent.push(m) } as unknown as Publisher,
  };
}

describe('failure routing', () => {
  it('walks the retry ladder then dead-letters', async () => {
    const { sent, publisher } = fakePublisher();
    expect(await routeFailure(publisher, message(0), 'notifications', 'retryable', new Error('x'))).toBe(
      'retry',
    );
    expect(await routeFailure(publisher, message(2), 'notifications', 'retryable', new Error('x'))).toBe(
      'retry',
    );
    expect(await routeFailure(publisher, message(3), 'notifications', 'retryable', new Error('x'))).toBe(
      'dlq',
    );
    expect(sent.map((m) => `${m.exchange}/${m.routingKey}`)).toEqual([
      'retry/q.notifications.retry.5s',
      'retry/q.notifications.retry.5m',
      'dlx/notifications',
    ]);
    expect(sent[0]!.headers!['x-retry-count']).toBe(1);
    expect(sent[2]!.headers!['x-original-queue']).toBe('q.notifications');
  });

  it('sends poison straight to the DLQ', async () => {
    const { sent, publisher } = fakePublisher();
    expect(
      await routeFailure(publisher, message(0), 'notifications', 'poison', new PoisonMessageError('bad')),
    ).toBe('dlq');
    expect(sent[0]!.headers!['x-error']).toContain('bad');
  });

  it('classifies errors and dedupes in memory', async () => {
    expect(defaultClassifyError(new PoisonMessageError('x'))).toBe('poison');
    expect(defaultClassifyError(new Error('x'))).toBe('retryable');
    const dedupe = new MemoryDeduper();
    expect(await dedupe.claim('c', '1')).toBe(true);
    expect(await dedupe.claim('c', '1')).toBe(false);
    expect([...(await dedupe.filterProcessed('c', ['1', '2']))]).toEqual(['1']);
  });
});
