import { assertTransition, type OrderStatus } from '@cip/contracts';
import { DomainError } from '../../../shared/errors';

export interface Order {
  id: string;
  number: number;
  customerId: string | null;
  email: string;
  status: OrderStatus;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  discountCode: string | null;
  shippingAddress: Record<string, unknown>;
  idempotencyKey: string;
  attribution: Record<string, unknown> | null;
  profileId: string | null;
  placedAt: Date;
}

export interface OrderItem {
  id: string;
  variantId: string;
  productId: string;
  title: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
}

export function transition(order: Order, to: OrderStatus): { from: OrderStatus; to: OrderStatus } {
  assertTransition(order.status, to);
  return { from: order.status, to };
}

export class OrderNotRefundableError extends DomainError {
  constructor(status: string) {
    super('INVALID_TRANSITION', 409, `Order in status ${status} cannot be refunded`);
  }
}

export class ManualTransitionNotAllowedError extends DomainError {
  constructor(to: string) {
    super('INVALID_TRANSITION', 409, `Status ${to} cannot be set manually`);
  }
}

export function orderTotals(input: { subtotalCents: number; discountCents: number; shippingCents: number }) {
  return {
    ...input,
    totalCents: Math.max(0, input.subtotalCents - input.discountCents) + input.shippingCents,
  };
}
