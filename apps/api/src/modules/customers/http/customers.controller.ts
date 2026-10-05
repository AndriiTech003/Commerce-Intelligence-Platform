import { Controller, Get, Inject } from '@nestjs/common';
import {
  customerListItemSchema,
  orderSummarySchema,
  pageSchema,
  profileViewSchema,
  uuid,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin } from '../../../shared/http/surface';
import { ZParam, ZQuery } from '../../../shared/http/zod';
import { CustomerService } from '../application/customer.service';

const listQuery = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

@Controller('v1/admin/customers')
export class CustomersController {
  constructor(@Inject(CustomerService) private readonly customers: CustomerService) {}

  @Get()
  @Admin('customers:read')
  @Doc({
    summary: 'Customers with order count and LTV',
    tags: ['customers'],
    query: listQuery,
    response: pageSchema(customerListItemSchema),
  })
  list(@ZQuery(listQuery) query: z.infer<typeof listQuery>) {
    return this.customers.list(query);
  }

  @Get(':id')
  @Admin('customers:read')
  @Doc({
    summary: 'Customer with orders and LTV',
    tags: ['customers'],
    response: customerListItemSchema.extend({
      anonymousIds: z.array(z.string()),
      orders: z.array(orderSummarySchema),
    }),
  })
  detail(@ZParam('id', uuid) id: string) {
    return this.customers.detail(id);
  }

  @Get(':id/timeline')
  @Admin('customers:read')
  @Doc({
    summary: 'Latest events of the customer from ClickHouse',
    tags: ['customers'],
    response: z.object({ data: z.array(z.record(z.string(), z.unknown())) }),
  })
  timeline(@ZParam('id', uuid) id: string) {
    return this.customers.timeline(id);
  }

  @Get(':id/profile')
  @Admin('customers:read')
  @Doc({
    summary: 'Personalization profile: affinities, price band, intent, segments with matched rules',
    tags: ['customers'],
    response: profileViewSchema,
  })
  profile(@ZParam('id', uuid) id: string) {
    return this.customers.profile(id);
  }
}
