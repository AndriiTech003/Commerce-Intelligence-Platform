export interface ShippingOption {
  id: string;
  label: string;
  cents: number;
  freeOverCents: number | null;
}

export function shippingPrice(option: ShippingOption, subtotalAfterDiscountCents: number): number {
  if (option.freeOverCents !== null && subtotalAfterDiscountCents >= option.freeOverCents) return 0;
  return option.cents;
}
