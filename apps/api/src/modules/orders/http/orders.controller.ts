import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  orderDetailSchema,
  orderListQuerySchema,
  orderSummarySchema,
  orderTransitionSchema,
  pageSchema,
  publicOrderSchema,
  refundSchema,
  uuid,
} from '@cip/contracts';
import { z } from 'zod';
import { requireCustomer } from '../../../shared/http/actor';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit, Idempotent, Storefront } from '../../../shared/http/surface';
import { ZBody, ZParam, ZQuery } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { OrderService } from '../application/order.service';

const idempotencyHeader = [
  { name: 'Idempotency-Key', required: true, description: 'Unique key per refund attempt' },
];

@Controller('v1')
export class OrdersController {
  constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  @Get('admin/orders')
  @Admin('orders:read')
  @Doc({
    summary: 'Orders with filters and cursor pagination',
    tags: ['orders'],
    query: orderListQuerySchema,
    response: pageSchema(orderSummarySchema),
  })
  list(@ZQuery(orderListQuerySchema) query: z.infer<typeof orderListQuerySchema>) {
    return this.orders.list(query);
  }

  @Get('admin/orders/:id')
  @Admin('orders:read')
  @Doc({
    summary: 'Order with history, payments and allowed transitions',
    tags: ['orders'],
    response: orderDetailSchema,
  })
  detail(@ZParam('id', uuid) id: string) {
    return this.orders.detail(id);
  }

  @Post('admin/orders/:id/transitions')
  @Admin('orders:manage')
  @HttpCode(200)
  @Audit('order.status_changed', 'order')
  @Doc({
    summary: 'Move an order through the state machine (fulfilled, delivered, cancelled)',
    tags: ['orders'],
    body: orderTransitionSchema,
    response: orderDetailSchema,
  })
  async transition(
    @ZParam('id', uuid) id: string,
    @ZBody(orderTransitionSchema) body: z.infer<typeof orderTransitionSchema>,
  ) {
    const { before, after } = await this.orders.transition(id, body.to, body.note);
    currentContext()?.audit.push({ entityId: id, before, after });
    return this.orders.detail(id);
  }

  @Post('admin/orders/:id/refund')
  @Admin('orders:manage')
  @HttpCode(200)
  @Idempotent({ required: true })
  @Audit('order.refunded', 'order')
  @Doc({
    summary: 'Full refund: provider refund, stock returned, order.refunded event',
    tags: ['orders'],
    body: refundSchema,
    response: z.object({ orderId: uuid, status: z.literal('refunded'), amountCents: z.number().int() }),
    headers: idempotencyHeader,
  })
  async refund(@ZParam('id', uuid) id: string, @ZBody(refundSchema) body: z.infer<typeof refundSchema>) {
    const { before, ...result } = await this.orders.refund(id, body.reason);
    currentContext()?.audit.push({ entityId: id, before, after: { status: 'refunded' } });
    return result;
  }

  @Get('storefront/orders/:id')
  @Storefront()
  @Doc({
    summary: 'Order status for the thank-you page (polled until paid)',
    tags: ['storefront'],
    response: publicOrderSchema,
  })
  publicOrder(@ZParam('id', uuid) id: string) {
    return this.orders.publicView(id);
  }

  @Get('storefront/account/orders')
  @Storefront('required')
  @Doc({
    summary: 'Order history of the logged-in customer',
    tags: ['storefront'],
    response: z.object({ data: z.array(orderSummarySchema) }),
  })
  accountOrders() {
    return this.orders.customerOrders(requireCustomer());
  }
}
