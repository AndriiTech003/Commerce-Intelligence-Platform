import { DomainError } from '../../../shared/errors';

export interface StockLine {
  variantId: string;
  quantity: number;
}

export interface Shortage {
  variantId: string;
  requested: number;
  available: number;
}

export class InsufficientStockError extends DomainError {
  constructor(readonly shortages: Shortage[]) {
    super(
      'INSUFFICIENT_STOCK',
      409,
      'Some items are no longer available in the requested quantity',
      shortages.map((s) => ({ ...s })),
    );
  }
}

export class StockAdjustmentError extends DomainError {
  constructor(message: string) {
    super('CONFLICT', 409, message);
  }
}

export function available(onHand: number, reserved: number): number {
  return onHand - reserved;
}

export function lockOrder(lines: StockLine[]): StockLine[] {
  const merged = new Map<string, number>();
  for (const line of lines) merged.set(line.variantId, (merged.get(line.variantId) ?? 0) + line.quantity);
  return [...merged.entries()]
    .map(([variantId, quantity]) => ({ variantId, quantity }))
    .sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
}

export function crossedLowStock(before: number, after: number, threshold: number): boolean {
  return before > threshold && after <= threshold;
}
