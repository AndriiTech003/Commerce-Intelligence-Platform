import type { DomainEventType } from '@cip/contracts';
import type { OutboxEvent } from '../domain/outbox-event';

export const OUTBOX_WRITER = Symbol('OUTBOX_WRITER');

export interface OutboxWriter {
  append<T extends DomainEventType>(event: OutboxEvent<T>): Promise<string>;
}
