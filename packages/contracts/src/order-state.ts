export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'fulfilled',
  'delivered',
  'cancelled',
  'refunded',
  'payment_failed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: ['cancelled'],
  paid: ['fulfilled', 'refunded'],
  fulfilled: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export const MANUAL_TRANSITIONS: readonly OrderStatus[] = ['fulfilled', 'delivered', 'cancelled'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return [...ORDER_TRANSITIONS[from]];
}

export function manualTransitions(from: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((s) => MANUAL_TRANSITIONS.includes(s));
}

export function isRefundable(status: OrderStatus): boolean {
  return canTransition(status, 'refunded');
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Order cannot move from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
