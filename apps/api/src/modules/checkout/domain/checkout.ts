import { shippingCost, type ShippingMethod } from '@cip/contracts';

export const RESERVATION_TTL_MINUTES = 15;

export function computeTotals(input: {
  subtotalCents: number;
  discountCents: number;
  shippingMethod: ShippingMethod;
}) {
  const afterDiscount = Math.max(0, input.subtotalCents - input.discountCents);
  const shippingCents = shippingCost(input.shippingMethod, afterDiscount);
  return {
    subtotalCents: input.subtotalCents,
    discountCents: input.discountCents,
    shippingCents,
    totalCents: afterDiscount + shippingCents,
  };
}
