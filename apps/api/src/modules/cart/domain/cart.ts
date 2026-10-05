import { DomainError } from '../../../shared/errors';

export const MAX_LINE_QUANTITY = 99;

export interface CartLine {
  variantId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  productStatus: string;
  variantTitle: string;
  sku: string;
  imageKey: string | null;
  categoryPath: string | null;
  quantity: number;
  unitPriceCents: number;
  addedPriceCents: number | null;
  onHand: number;
  reserved: number;
  currency: string;
}

export interface PricedLine extends CartLine {
  previousUnitPriceCents: number | null;
  priceChanged: boolean;
  lineTotalCents: number;
  available: number;
}

export function priceLines(lines: CartLine[]): {
  lines: PricedLine[];
  subtotalCents: number;
  itemsCount: number;
} {
  const priced = lines
    .filter((l) => l.productStatus === 'active')
    .map((line) => {
      const changed = line.addedPriceCents !== null && line.addedPriceCents !== line.unitPriceCents;
      return {
        ...line,
        previousUnitPriceCents: changed ? line.addedPriceCents : null,
        priceChanged: changed,
        lineTotalCents: line.unitPriceCents * line.quantity,
        available: Math.max(0, line.onHand - line.reserved),
      };
    });
  return {
    lines: priced,
    subtotalCents: priced.reduce((sum, l) => sum + l.lineTotalCents, 0),
    itemsCount: priced.reduce((sum, l) => sum + l.quantity, 0),
  };
}

export function mergeQuantities(target: number, incoming: number): number {
  return Math.min(MAX_LINE_QUANTITY, target + incoming);
}

export class CartEmptyError extends DomainError {
  constructor() {
    super('CART_EMPTY', 422, 'Cart is empty');
  }
}

export class ProductUnavailableError extends DomainError {
  constructor(variantId: string) {
    super('NOT_FOUND', 404, `Variant ${variantId} is not available`);
  }
}
