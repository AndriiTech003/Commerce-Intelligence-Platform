import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@cip/contracts';
import {
  inventoryItems,
  inventoryMovements,
  inventoryReservations,
  products,
  productVariants,
} from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { StockLine } from '../domain/inventory';
import type { InventoryRepository, StockRow } from '../application/ports';

const stockColumns = {
  variantId: inventoryItems.variantId,
  onHand: inventoryItems.onHand,
  reserved: inventoryItems.reserved,
};

@Injectable()
export class DrizzleInventoryRepository implements InventoryRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async initialize(variantId: string, onHand: number) {
    await this.db
      .tx()
      .insert(inventoryItems)
      .values({ variantId, tenantId: this.db.tenantId(), onHand, reserved: 0 })
      .onConflictDoNothing();
  }

  async get(variantIds: string[]): Promise<StockRow[]> {
    if (variantIds.length === 0) return [];
    return this.db
      .tx()
      .select(stockColumns)
      .from(inventoryItems)
      .where(inArray(inventoryItems.variantId, variantIds));
  }

  async adjust(variantId: string, delta: number) {
    const [row] = await this.db
      .tx()
      .update(inventoryItems)
      .set({ onHand: sql`${inventoryItems.onHand} + ${delta}` })
      .where(
        and(
          eq(inventoryItems.variantId, variantId),
          sql`${inventoryItems.onHand} + ${delta} >= ${inventoryItems.reserved}`,
          sql`${inventoryItems.onHand} + ${delta} >= 0`,
        ),
      )
      .returning(stockColumns);
    return row ?? null;
  }

  async reserve(variantId: string, quantity: number) {
    const rows = await this.db
      .tx()
      .update(inventoryItems)
      .set({ reserved: sql`${inventoryItems.reserved} + ${quantity}` })
      .where(
        and(
          eq(inventoryItems.variantId, variantId),
          sql`${inventoryItems.onHand} - ${inventoryItems.reserved} >= ${quantity}`,
        ),
      )
      .returning({ variantId: inventoryItems.variantId });
    return rows.length > 0;
  }

  async releaseReserved(variantId: string, quantity: number) {
    const [row] = await this.db
      .tx()
      .update(inventoryItems)
      .set({ reserved: sql`greatest(${inventoryItems.reserved} - ${quantity}, 0)` })
      .where(eq(inventoryItems.variantId, variantId))
      .returning(stockColumns);
    return row ?? null;
  }

  async commitSale(variantId: string, quantity: number) {
    const [row] = await this.db
      .tx()
      .update(inventoryItems)
      .set({
        onHand: sql`${inventoryItems.onHand} - ${quantity}`,
        reserved: sql`${inventoryItems.reserved} - ${quantity}`,
      })
      .where(and(eq(inventoryItems.variantId, variantId), sql`${inventoryItems.reserved} >= ${quantity}`))
      .returning(stockColumns);
    return row ?? null;
  }

  async restock(variantId: string, quantity: number) {
    const [row] = await this.db
      .tx()
      .update(inventoryItems)
      .set({ onHand: sql`${inventoryItems.onHand} + ${quantity}` })
      .where(eq(inventoryItems.variantId, variantId))
      .returning(stockColumns);
    return row ?? null;
  }

  async insertMovement(row: {
    variantId: string;
    delta: number;
    reason: string;
    referenceId: string | null;
    actorId: string | null;
  }) {
    await this.db
      .tx()
      .insert(inventoryMovements)
      .values({ id: uuidv7(), tenantId: this.db.tenantId(), ...row });
  }

  async movements(variantId: string, limit: number) {
    return this.db
      .tx()
      .select({
        id: inventoryMovements.id,
        delta: inventoryMovements.delta,
        reason: inventoryMovements.reason,
        referenceId: inventoryMovements.referenceId,
        actorId: inventoryMovements.actorId,
        createdAt: inventoryMovements.createdAt,
      })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variantId))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(limit);
  }

  async insertReservations(orderId: string, lines: StockLine[], expiresAt: Date) {
    if (lines.length === 0) return;
    await this.db
      .tx()
      .insert(inventoryReservations)
      .values(
        lines.map((l) => ({
          id: uuidv7(),
          tenantId: this.db.tenantId(),
          orderId,
          variantId: l.variantId,
          quantity: l.quantity,
          status: 'active',
          expiresAt,
        })),
      );
  }

  async reservationsOf(orderId: string, status: 'active' | 'committed' | 'released') {
    return this.db
      .tx()
      .select({ variantId: inventoryReservations.variantId, quantity: inventoryReservations.quantity })
      .from(inventoryReservations)
      .where(and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, status)));
  }

  async setReservationStatus(orderId: string, from: 'active' | 'committed', to: 'committed' | 'released') {
    const rows = await this.db
      .tx()
      .update(inventoryReservations)
      .set({ status: to })
      .where(and(eq(inventoryReservations.orderId, orderId), eq(inventoryReservations.status, from)))
      .returning({ id: inventoryReservations.id });
    return rows.length;
  }

  async list(query: {
    q?: string | undefined;
    lowStockThreshold?: number | undefined;
    limit: number;
    cursor: string | null;
  }) {
    const conditions: SQL[] = [];
    if (query.q) {
      const like = `%${query.q}%`;
      conditions.push(sql`(${products.title} ilike ${like} or ${productVariants.sku} ilike ${like})`);
    }
    if (query.lowStockThreshold !== undefined) {
      conditions.push(
        sql`${inventoryItems.onHand} - ${inventoryItems.reserved} <= ${query.lowStockThreshold}`,
      );
    }
    if (query.cursor) conditions.push(sql`${inventoryItems.variantId} > ${query.cursor}::uuid`);
    return this.db
      .tx()
      .select({
        variantId: inventoryItems.variantId,
        productId: products.id,
        productTitle: products.title,
        sku: productVariants.sku,
        variantTitle: productVariants.title,
        onHand: inventoryItems.onHand,
        reserved: inventoryItems.reserved,
      })
      .from(inventoryItems)
      .innerJoin(productVariants, eq(productVariants.id, inventoryItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(inventoryItems.variantId))
      .limit(query.limit);
  }
}
