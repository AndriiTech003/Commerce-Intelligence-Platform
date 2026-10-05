import { DomainError } from '../../../shared/errors';

export interface Discount {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  active: boolean;
}

export type DiscountEvaluation = { ok: true; amountCents: number } | { ok: false; reason: string };

export function evaluateDiscount(
  discount: Discount,
  input: { subtotalCents: number; now: Date; customerUses: number },
): DiscountEvaluation {
  if (!discount.active) return { ok: false, reason: 'This code is not active' };
  if (discount.startsAt && input.now < discount.startsAt)
    return { ok: false, reason: 'This code is not active yet' };
  if (discount.endsAt && input.now > discount.endsAt) return { ok: false, reason: 'This code has expired' };
  if (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) {
    return { ok: false, reason: 'This code has reached its usage limit' };
  }
  if (discount.perCustomerLimit !== null && input.customerUses >= discount.perCustomerLimit) {
    return { ok: false, reason: 'You have already used this code' };
  }
  if (input.subtotalCents < discount.minSubtotalCents) {
    return {
      ok: false,
      reason: `Minimum order for this code is ${(discount.minSubtotalCents / 100).toFixed(2)}`,
    };
  }
  const raw =
    discount.type === 'percent' ? Math.floor((input.subtotalCents * discount.value) / 100) : discount.value;
  return { ok: true, amountCents: Math.max(0, Math.min(raw, input.subtotalCents)) };
}

export class DiscountInvalidError extends DomainError {
  constructor(reason: string) {
    super('DISCOUNT_INVALID', 422, reason);
  }
}

export class DiscountExhaustedError extends DomainError {
  constructor() {
    super('DISCOUNT_INVALID', 422, 'This code has reached its usage limit');
  }
}
