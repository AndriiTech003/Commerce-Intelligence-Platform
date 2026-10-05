import { Inject, Injectable } from '@nestjs/common';
import { logicalNameFromDlq } from '@cip/contracts';
import { NotFoundError, ServiceUnavailableError } from '../../../shared/errors';
import { TenantService } from '../../tenancy';
import { DLQ_ADMIN, type DlqPort } from './ports';

@Injectable()
export class PlatformService {
  constructor(
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(DLQ_ADMIN) private readonly dlq: DlqPort,
  ) {}

  async tenantList() {
    const rows = await this.tenants.listAll();
    return {
      data: rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        members: t.members,
        products: t.products,
        orders: t.orders,
      })),
    };
  }

  private guard<T>(fn: () => Promise<T>): Promise<T> {
    return fn().catch((error: unknown) => {
      if ((error as Error).message?.includes('not connected'))
        throw new ServiceUnavailableError('RabbitMQ is not connected');
      throw error;
    });
  }

  dlqList() {
    return this.guard(async () => ({ data: await this.dlq.list() }));
  }

  dlqPeek(queue: string, limit: number) {
    if (!logicalNameFromDlq(queue)) throw new NotFoundError('DLQ', queue);
    return this.guard(async () => ({ data: await this.dlq.peek(queue, limit) }));
  }

  dlqReplay(queue: string, ids: string[] | 'all') {
    if (!logicalNameFromDlq(queue)) throw new NotFoundError('DLQ', queue);
    return this.guard(() => this.dlq.replay(queue, ids));
  }
}
