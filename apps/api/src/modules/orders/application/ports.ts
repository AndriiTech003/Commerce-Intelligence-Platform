import type { OrderStatus } from '@cip/contracts';
import type { Order, OrderItem } from '../domain/order';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface OrderListQuery {
  status?: OrderStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
  customerId?: string | undefined;
  email?: string | undefined;
  number?: number | undefined;
  minTotal?: number | undefined;
  maxTotal?: number | undefined;
  limit: number;
  cursor: { v: string | number; id: string } | null;
}

export interface OrderHistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  actorId: string | null;
  createdAt: Date;
}

export interface OrderPaymentRow {
  id: string;
  provider: string;
  providerRef: string;
  clientSecret: string | null;
  status: string;
  amountCents: number;
  createdAt: Date;
}

export interface OrderRepository {
  nextNumber(): Promise<number>;
  insert(order: Order, items: OrderItem[]): Promise<void>;
  find(id: string): Promise<Order | null>;
  findForUpdate(id: string): Promise<Order | null>;
  findByIdempotencyKey(key: string): Promise<Order | null>;
  items(orderId: string): Promise<OrderItem[]>;
  itemsCount(orderIds: string[]): Promise<Map<string, number>>;
  history(orderId: string): Promise<OrderHistoryRow[]>;
  payments(orderId: string): Promise<OrderPaymentRow[]>;
  setStatus(orderId: string, status: OrderStatus): Promise<void>;
  addHistory(
    orderId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    reason: string | null,
    actorId: string | null,
  ): Promise<void>;
  list(query: OrderListQuery): Promise<Order[]>;
  listForCustomer(customerId: string, limit: number): Promise<Order[]>;
  categoryPaths(productIds: string[]): Promise<Map<string, string>>;
}

export interface PaymentGateway {
  refund(orderId: string, amountCents: number): Promise<void>;
}
