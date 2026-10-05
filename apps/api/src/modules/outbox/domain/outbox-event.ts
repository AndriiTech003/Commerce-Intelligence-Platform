import type { DomainEventType, DomainPayload } from '@cip/contracts';

export interface OutboxEvent<T extends DomainEventType = DomainEventType> {
  id?: string;
  aggregateType: string;
  aggregateId: string;
  eventType: T;
  payload: DomainPayload<T>;
}
