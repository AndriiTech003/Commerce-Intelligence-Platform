import type { StockLine } from '../domain/inventory';

export const INVENTORY_REPOSITORY = Symbol('INVENTORY_REPOSITORY');

export interface StockRow {
  variantId: string;
  onHand: number;
  reserved: number;
}

export interface InventoryListRow {
  variantId: string;
  productId: string;
  productTitle: string;
  sku: string;
  variantTitle: string;
  onHand: number;
  reserved: number;
}

export interface MovementRow {
  id: string;
  delta: number;
  reason: string;
  referenceId: string | null;
  actorId: string | null;
  createdAt: Date;
}

export interface InventoryRepository {
  initialize(variantId: string, onHand: number): Promise<void>;
  get(variantIds: string[]): Promise<StockRow[]>;
  adjust(variantId: string, delta: number): Promise<StockRow | null>;
  reserve(variantId: string, quantity: number): Promise<boolean>;
  releaseReserved(variantId: string, quantity: number): Promise<StockRow | null>;
  commitSale(variantId: string, quantity: number): Promise<StockRow | null>;
  restock(variantId: string, quantity: number): Promise<StockRow | null>;
  insertMovement(row: {
    variantId: string;
    delta: number;
    reason: string;
    referenceId: string | null;
    actorId: string | null;
  }): Promise<void>;
  movements(variantId: string, limit: number): Promise<MovementRow[]>;
  insertReservations(orderId: string, lines: StockLine[], expiresAt: Date): Promise<void>;
  reservationsOf(orderId: string, status: 'active' | 'committed' | 'released'): Promise<StockLine[]>;
  setReservationStatus(
    orderId: string,
    from: 'active' | 'committed',
    to: 'committed' | 'released',
  ): Promise<number>;
  list(query: {
    q?: string | undefined;
    lowStockThreshold?: number | undefined;
    limit: number;
    cursor: string | null;
  }): Promise<InventoryListRow[]>;
}
