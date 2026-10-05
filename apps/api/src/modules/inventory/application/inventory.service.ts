import { Inject, Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@cip/contracts';
import { NotFoundError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import { OUTBOX_WRITER, type OutboxWriter } from '../../outbox';
import { TenantService, UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  available,
  crossedLowStock,
  InsufficientStockError,
  lockOrder,
  StockAdjustmentError,
  type Shortage,
  type StockLine,
} from '../domain/inventory';
import { INVENTORY_REPOSITORY, type InventoryRepository, type StockRow } from './ports';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly repo: InventoryRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  private async threshold(): Promise<number> {
    return (await this.tenants.current()).settings.lowStockThreshold;
  }

  private async emitLowStock(before: StockRow | undefined, after: StockRow, threshold: number) {
    const prev = before ? available(before.onHand, before.reserved) : Number.MAX_SAFE_INTEGER;
    const next = available(after.onHand, after.reserved);
    if (crossedLowStock(prev, next, threshold)) {
      await this.outbox.append({
        aggregateType: 'inventory',
        aggregateId: after.variantId,
        eventType: 'inventory.low_stock',
        payload: { variant_id: after.variantId, available: next, threshold },
      });
    }
  }

  initialize(variantId: string, onHand: number) {
    return this.repo.initialize(variantId, onHand);
  }

  stockOf(variantIds: string[]) {
    return this.repo.get(variantIds);
  }

  async list(query: {
    q?: string | undefined;
    lowStock?: boolean | undefined;
    limit: number;
    cursor?: string | undefined;
  }) {
    return this.uow.run(async () => {
      const threshold = await this.threshold();
      const rows = await this.repo.list({
        q: query.q,
        lowStockThreshold: query.lowStock ? threshold : undefined,
        limit: query.limit + 1,
        cursor: decodeCursor(query.cursor)?.id ?? null,
      });
      const page = rows.slice(0, query.limit);
      return {
        data: page.map((r) => ({
          ...r,
          available: available(r.onHand, r.reserved),
          lowStock: available(r.onHand, r.reserved) <= threshold,
        })),
        nextCursor:
          rows.length > query.limit ? encodeCursor({ v: 0, id: page[page.length - 1]!.variantId }) : null,
      };
    });
  }

  async adjust(variantId: string, delta: number, reason: string) {
    return this.uow.run(async () => {
      const [before] = await this.repo.get([variantId]);
      if (!before) throw new NotFoundError('Variant', variantId);
      const after = await this.repo.adjust(variantId, delta);
      if (!after)
        throw new StockAdjustmentError('Adjustment would make stock negative or below reserved quantity');
      await this.repo.insertMovement({
        variantId,
        delta,
        reason: `manual_adjustment: ${reason}`,
        referenceId: null,
        actorId: currentContext()?.actor?.id ?? null,
      });
      await this.emitLowStock(before, after, await this.threshold());
      return {
        before: { onHand: before.onHand, reserved: before.reserved },
        after: {
          onHand: after.onHand,
          reserved: after.reserved,
          available: available(after.onHand, after.reserved),
        },
      };
    });
  }

  async setOnHand(variantId: string, onHand: number, reason: string) {
    const [current] = await this.repo.get([variantId]);
    if (!current) {
      await this.repo.initialize(variantId, onHand);
      return;
    }
    const delta = onHand - current.onHand;
    if (delta === 0) return;
    const after = await this.repo.adjust(variantId, delta);
    if (!after) throw new StockAdjustmentError('On hand cannot be lower than the reserved quantity');
    await this.repo.insertMovement({
      variantId,
      delta,
      reason,
      referenceId: null,
      actorId: currentContext()?.actor?.id ?? null,
    });
  }

  async movements(variantId: string) {
    const rows = await this.uow.run(() => this.repo.movements(variantId, 200));
    return { data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  }

  async reserveForOrder(orderId: string, lines: StockLine[], expiresAt: Date): Promise<void> {
    const ordered = lockOrder(lines);
    const failed: StockLine[] = [];
    for (const line of ordered) {
      if (!(await this.repo.reserve(line.variantId, line.quantity))) failed.push(line);
    }
    if (failed.length > 0) {
      const stock = await this.repo.get(failed.map((f) => f.variantId));
      const shortages: Shortage[] = failed.map((f) => {
        const row = stock.find((s) => s.variantId === f.variantId);
        return {
          variantId: f.variantId,
          requested: f.quantity,
          available: row ? Math.max(0, available(row.onHand, row.reserved)) : 0,
        };
      });
      throw new InsufficientStockError(shortages);
    }
    await this.repo.insertReservations(orderId, ordered, expiresAt);
  }

  async releaseOrder(orderId: string): Promise<number> {
    const lines = lockOrder(await this.repo.reservationsOf(orderId, 'active'));
    if (lines.length === 0) return 0;
    for (const line of lines) await this.repo.releaseReserved(line.variantId, line.quantity);
    return this.repo.setReservationStatus(orderId, 'active', 'released');
  }

  async commitOrder(orderId: string): Promise<number> {
    const lines = lockOrder(await this.repo.reservationsOf(orderId, 'active'));
    if (lines.length === 0) return 0;
    const threshold = await this.threshold();
    const before = await this.repo.get(lines.map((l) => l.variantId));
    for (const line of lines) {
      const after = await this.repo.commitSale(line.variantId, line.quantity);
      if (!after) throw new StockAdjustmentError(`Could not commit reservation for ${line.variantId}`);
      await this.repo.insertMovement({
        variantId: line.variantId,
        delta: -line.quantity,
        reason: 'sale',
        referenceId: orderId,
        actorId: null,
      });
      await this.emitLowStock(
        before.find((b) => b.variantId === line.variantId),
        after,
        threshold,
      );
    }
    return this.repo.setReservationStatus(orderId, 'active', 'committed');
  }

  async restockOrder(orderId: string): Promise<number> {
    const lines = lockOrder(await this.repo.reservationsOf(orderId, 'committed'));
    for (const line of lines) {
      await this.repo.restock(line.variantId, line.quantity);
      await this.repo.insertMovement({
        variantId: line.variantId,
        delta: line.quantity,
        reason: 'refund',
        referenceId: orderId,
        actorId: currentContext()?.actor?.id ?? null,
      });
    }
    if (lines.length > 0) await this.repo.setReservationStatus(orderId, 'committed', 'released');
    return lines.length;
  }
}
