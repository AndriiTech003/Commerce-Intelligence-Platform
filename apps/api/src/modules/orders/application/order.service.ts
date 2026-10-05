import { Inject, Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  isRefundable,
  manualTransitions,
  MANUAL_TRANSITIONS,
  uuidv7,
  type OrderStatus,
} from '@cip/contracts';
import { NotFoundError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import { DiscountService } from '../../discounts';
import { InventoryService } from '../../inventory';
import { OUTBOX_WRITER, type OutboxWriter } from '../../outbox';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  ManualTransitionNotAllowedError,
  OrderNotRefundableError,
  transition,
  type Order,
  type OrderItem,
} from '../domain/order';
import {
  ORDER_REPOSITORY,
  PAYMENT_GATEWAY,
  type OrderListQuery,
  type OrderPaymentRow,
  type OrderRepository,
  type PaymentGateway,
} from './ports';

export interface NewOrder {
  id: string;
  customerId: string | null;
  email: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  discountCode: string | null;
  shippingAddress: Record<string, unknown>;
  idempotencyKey: string;
  attribution: Record<string, unknown> | null;
  profileId: string;
  items: Array<Omit<OrderItem, 'id'> & { categoryPath: string | null }>;
}

@Injectable()
export class OrderService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly repo: OrderRepository,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(DiscountService) private readonly discounts: DiscountService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  private actorId(): string | null {
    const actor = currentContext()?.actor;
    return actor && actor.type === 'user' ? actor.id : null;
  }

  async place(input: NewOrder): Promise<Order> {
    const number = await this.repo.nextNumber();
    const order: Order = {
      id: input.id,
      number,
      customerId: input.customerId,
      email: input.email,
      status: 'pending_payment',
      currency: input.currency,
      subtotalCents: input.subtotalCents,
      discountCents: input.discountCents,
      shippingCents: input.shippingCents,
      totalCents: input.totalCents,
      discountCode: input.discountCode,
      shippingAddress: input.shippingAddress,
      idempotencyKey: input.idempotencyKey,
      attribution: input.attribution,
      profileId: input.profileId,
      placedAt: new Date(),
    };
    await this.repo.insert(
      order,
      input.items.map((i) => ({ ...i, id: uuidv7() })),
    );
    await this.repo.addHistory(order.id, null, 'pending_payment', 'checkout', null);
    await this.outbox.append({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.placed',
      payload: {
        order_id: order.id,
        number,
        customer_id: order.customerId,
        profile_id: input.profileId,
        email: order.email,
        items: input.items.map((i) => ({
          product_id: i.productId,
          variant_id: i.variantId,
          qty: i.quantity,
          unit_price_cents: i.unitPriceCents,
          category_path: i.categoryPath ?? '',
          title: i.title,
        })),
        total_cents: order.totalCents,
        currency: order.currency,
        attribution: order.attribution,
        discount_code: order.discountCode,
        discount_cents: order.discountCents,
      },
    });
    return order;
  }

  findByIdempotencyKey(key: string) {
    return this.repo.findByIdempotencyKey(key);
  }

  find(id: string) {
    return this.repo.find(id);
  }

  items(id: string) {
    return this.repo.items(id);
  }

  payment(id: string): Promise<OrderPaymentRow | null> {
    return this.repo.payments(id).then((rows) => rows[rows.length - 1] ?? null);
  }

  async markPaid(orderId: string, amountCents: number): Promise<'paid' | 'ignored'> {
    const order = await this.repo.findForUpdate(orderId);
    if (!order) throw new NotFoundError('Order', orderId);
    if (order.status !== 'pending_payment') return 'ignored';
    transition(order, 'paid');
    await this.inventory.commitOrder(order.id);
    await this.repo.setStatus(order.id, 'paid');
    await this.repo.addHistory(order.id, order.status, 'paid', 'payment_succeeded', null);
    await this.outbox.append({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.paid',
      payload: { order_id: order.id, amount_cents: amountCents, number: order.number },
    });
    return 'paid';
  }

  async markPaymentFailed(orderId: string): Promise<'payment_failed' | 'ignored'> {
    const order = await this.repo.findForUpdate(orderId);
    if (!order) throw new NotFoundError('Order', orderId);
    if (order.status !== 'pending_payment') return 'ignored';
    transition(order, 'payment_failed');
    await this.inventory.releaseOrder(order.id);
    await this.releaseDiscount(order);
    await this.repo.setStatus(order.id, 'payment_failed');
    await this.repo.addHistory(order.id, order.status, 'payment_failed', 'payment_failed', null);
    return 'payment_failed';
  }

  private async releaseDiscount(order: Order) {
    if (!order.discountCode) return;
    const discount = await this.discounts.findByCode(order.discountCode);
    if (discount) await this.discounts.release(discount.id);
  }

  async transition(orderId: string, to: OrderStatus, note: string | undefined) {
    if (!MANUAL_TRANSITIONS.includes(to)) throw new ManualTransitionNotAllowedError(to);
    return this.uow.run(async () => {
      const order = await this.repo.findForUpdate(orderId);
      if (!order) throw new NotFoundError('Order', orderId);
      const { from } = transition(order, to);
      if (to === 'cancelled') {
        await this.inventory.releaseOrder(order.id);
        await this.releaseDiscount(order);
      }
      await this.repo.setStatus(order.id, to);
      await this.repo.addHistory(order.id, from, to, note ?? null, this.actorId());
      if (to === 'cancelled') {
        await this.outbox.append({
          aggregateType: 'order',
          aggregateId: order.id,
          eventType: 'order.cancelled',
          payload: { order_id: order.id, reason: note ?? 'cancelled_by_staff' },
        });
      }
      if (to === 'fulfilled') {
        await this.outbox.append({
          aggregateType: 'order',
          aggregateId: order.id,
          eventType: 'order.fulfilled',
          payload: { order_id: order.id },
        });
      }
      return { before: { status: from }, after: { status: to } };
    });
  }

  async refund(orderId: string, reason: string | undefined) {
    return this.uow.run(async () => {
      const order = await this.repo.findForUpdate(orderId);
      if (!order) throw new NotFoundError('Order', orderId);
      if (!isRefundable(order.status)) throw new OrderNotRefundableError(order.status);
      const { from } = transition(order, 'refunded');
      await this.payments.refund(order.id, order.totalCents);
      await this.inventory.restockOrder(order.id);
      await this.repo.setStatus(order.id, 'refunded');
      await this.repo.addHistory(order.id, from, 'refunded', reason ?? 'refund', this.actorId());
      await this.outbox.append({
        aggregateType: 'order',
        aggregateId: order.id,
        eventType: 'order.refunded',
        payload: {
          order_id: order.id,
          amount_cents: order.totalCents,
          profile_id: order.profileId ?? undefined,
        },
      });
      return {
        orderId: order.id,
        status: 'refunded' as const,
        amountCents: order.totalCents,
        before: { status: from },
      };
    });
  }

  summary(order: Order, itemsCount: number) {
    return {
      id: order.id,
      number: order.number,
      email: order.email,
      customerId: order.customerId,
      status: order.status,
      currency: order.currency,
      totalCents: order.totalCents,
      itemsCount,
      placedAt: order.placedAt.toISOString(),
    };
  }

  async list(query: Omit<OrderListQuery, 'cursor'> & { cursor?: string | undefined }) {
    return this.uow.run(async () => {
      const rows = await this.repo.list({
        ...query,
        cursor: decodeCursor(query.cursor),
        limit: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const counts = await this.repo.itemsCount(page.map((o) => o.id));
      const last = page[page.length - 1];
      return {
        data: page.map((o) => this.summary(o, counts.get(o.id) ?? 0)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ v: last.placedAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  private itemView(i: OrderItem) {
    return {
      id: i.id,
      variantId: i.variantId,
      productId: i.productId,
      title: i.title,
      sku: i.sku,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
    };
  }

  async detail(orderId: string) {
    return this.uow.run(async () => {
      const order = await this.repo.find(orderId);
      if (!order) throw new NotFoundError('Order', orderId);
      const items = await this.repo.items(orderId);
      const history = await this.repo.history(orderId);
      const payments = await this.repo.payments(orderId);
      return {
        ...this.summary(
          order,
          items.reduce((s, i) => s + i.quantity, 0),
        ),
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        shippingCents: order.shippingCents,
        discountCode: order.discountCode,
        shippingAddress: order.shippingAddress,
        attribution: order.attribution,
        items: items.map((i) => this.itemView(i)),
        history: history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
        payments: payments.map((p) => ({
          id: p.id,
          provider: p.provider,
          providerRef: p.providerRef,
          status: p.status,
          amountCents: p.amountCents,
          createdAt: p.createdAt.toISOString(),
        })),
        allowedTransitions: manualTransitions(order.status),
        refundable: isRefundable(order.status),
      };
    });
  }

  async publicView(orderId: string) {
    return this.uow.run(async () => {
      const order = await this.repo.find(orderId);
      if (!order) throw new NotFoundError('Order', orderId);
      const items = await this.repo.items(orderId);
      const payments = await this.repo.payments(orderId);
      const payment = payments[payments.length - 1];
      return {
        id: order.id,
        number: order.number,
        status: order.status,
        currency: order.currency,
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        shippingCents: order.shippingCents,
        totalCents: order.totalCents,
        email: order.email,
        placedAt: order.placedAt.toISOString(),
        items: items.map((i) => this.itemView(i)),
        payment: payment
          ? {
              provider: payment.provider,
              intentId: payment.providerRef,
              clientSecret: payment.clientSecret ?? '',
            }
          : null,
      };
    });
  }

  async customerOrders(customerId: string) {
    return this.uow.run(async () => {
      const rows = await this.repo.listForCustomer(customerId, 100);
      const counts = await this.repo.itemsCount(rows.map((o) => o.id));
      return { data: rows.map((o) => this.summary(o, counts.get(o.id) ?? 0)) };
    });
  }

  categoryPaths(productIds: string[]) {
    return this.repo.categoryPaths(productIds);
  }
}
