import { Inject, Injectable } from '@nestjs/common';
import { domainPayloadSchemas, uuidv7, type DomainEventType } from '@cip/contracts';
import { currentTraceparent } from '@cip/observability';
import { outbox } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { OutboxWriter } from '../application/ports';
import type { OutboxEvent } from '../domain/outbox-event';

@Injectable()
export class DrizzleOutboxWriter implements OutboxWriter {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async append<T extends DomainEventType>(event: OutboxEvent<T>): Promise<string> {
    const payload = domainPayloadSchemas[event.eventType].parse(event.payload) as Record<string, unknown>;
    const id = event.id ?? uuidv7();
    const traceparent = currentTraceparent();
    await this.db
      .tx()
      .insert(outbox)
      .values({
        id,
        tenantId: this.db.tenantId(),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload,
        headers: { schema_version: 1, ...(traceparent ? { traceparent } : {}) },
      });
    return id;
  }
}
