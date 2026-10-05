import { Inject, Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@cip/contracts';
import { NotFoundError } from '../../../shared/errors';
import { AnalyticsService } from '../../analytics';
import { OrderService } from '../../orders';
import { ProfileService } from '../../personalization';
import { currentContext } from '../../../shared/request-context';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { CUSTOMER_QUERIES, type CustomerQueries, type CustomerSummaryRow } from './ports';

@Injectable()
export class CustomerService {
  constructor(
    @Inject(CUSTOMER_QUERIES) private readonly queries: CustomerQueries,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  private view(row: CustomerSummaryRow) {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      registered: row.registered,
      ordersCount: row.ordersCount,
      ltvCents: row.ltvCents,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: { q?: string | undefined; limit: number; cursor?: string | undefined }) {
    const rows = await this.uow.run(() =>
      this.queries.list({
        q: query.q,
        limit: query.limit + 1,
        cursor: decodeCursor(query.cursor)?.id ?? null,
      }),
    );
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((r) => this.view(r)),
      nextCursor: rows.length > query.limit ? encodeCursor({ v: 0, id: page[page.length - 1]!.id }) : null,
    };
  }

  async detail(id: string) {
    const row = await this.uow.run(() => this.queries.find(id));
    if (!row) throw new NotFoundError('Customer', id);
    const orders = await this.orders.list({ customerId: id, limit: 50 });
    return { ...this.view(row), anonymousIds: row.anonymousIds, orders: orders.data };
  }

  async timeline(id: string) {
    const row = await this.uow.run(() => this.queries.find(id));
    if (!row) throw new NotFoundError('Customer', id);
    return { data: await this.analytics.timeline(id, row.anonymousIds) };
  }

  async profile(id: string) {
    const row = await this.uow.run(() => this.queries.find(id));
    if (!row) throw new NotFoundError('Customer', id);
    return this.profiles.view(currentContext()!.tenantId!, id, { customerId: id });
  }
}
