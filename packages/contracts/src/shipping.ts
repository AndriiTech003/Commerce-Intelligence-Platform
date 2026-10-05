export const SHIPPING_METHODS = ['standard', 'express'] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

export const SHIPPING_RATES: Record<
  ShippingMethod,
  { label: string; cents: number; freeOverCents: number | null }
> = {
  standard: { label: 'Standard (3–5 days)', cents: 500, freeOverCents: 10000 },
  express: { label: 'Express (1–2 days)', cents: 1500, freeOverCents: null },
};

export function shippingCost(method: ShippingMethod, subtotalAfterDiscountCents: number): number {
  const rate = SHIPPING_RATES[method];
  if (rate.freeOverCents !== null && subtotalAfterDiscountCents >= rate.freeOverCents) return 0;
  return rate.cents;
}
