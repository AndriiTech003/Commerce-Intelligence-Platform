import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { cartItems, carts } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { CartLine } from '../domain/cart';
import type { CartOwner, CartRecord, CartRepository, VariantInfo } from '../application/ports';

function ownerCondition(owner: CartOwner) {
  return owner.customerId
    ? eq(carts.customerId, owner.customerId)
    : eq(carts.anonymousId, owner.anonymousId!);
}

const cartColumns = {
  id: carts.id,
  customerId: carts.customerId,
  anonymousId: carts.anonymousId,
  discountCode: carts.discountCode,
};

@Injectable()
export class DrizzleCartRepository implements CartRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async findActive(owner: CartOwner): Promise<CartRecord | null> {
    const [row] = await this.db
      .tx()
      .select(cartColumns)
      .from(carts)
      .where(and(ownerCondition(owner), eq(carts.status, 'active')))
      .limit(1);
    return row ?? null;
  }

  async findActiveForUpdate(owner: CartOwner): Promise<CartRecord | null> {
    const [row] = await this.db
      .tx()
      .select(cartColumns)
      .from(carts)
      .where(and(ownerCondition(owner), eq(carts.status, 'active')))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async create(id: string, owner: CartOwner): Promise<CartRecord> {
    const [row] = await this.db
      .tx()
      .insert(carts)
      .values({
        id,
        tenantId: this.db.tenantId(),
        customerId: owner.customerId,
        anonymousId: owner.anonymousId,
      })
      .returning(cartColumns);
    return row!;
  }

  async lines(cartId: string): Promise<CartLine[]> {
    const result = await this.db.tx().execute(sql`
      select ci.variant_id, ci.quantity, ci.added_price_cents, v.product_id, v.title as variant_title, v.sku, v.price_cents, v.currency,
        p.title as product_title, p.slug as product_slug, p.status as product_status, c.path::text as category_path,
        coalesce(i.on_hand, 0) as on_hand, coalesce(i.reserved, 0) as reserved,
        (select pi.storage_key from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image_key
      from cart_items ci
        join product_variants v on v.id = ci.variant_id
        join products p on p.id = v.product_id
        left join categories c on c.id = p.category_id
        left join inventory_items i on i.variant_id = v.id
      where ci.cart_id = ${cartId}
      order by ci.added_at, ci.variant_id`);
    return (result.rows as Array<Record<string, unknown>>).map((r) => ({
      variantId: String(r.variant_id),
      productId: String(r.product_id),
      productTitle: String(r.product_title),
      productSlug: String(r.product_slug),
      productStatus: String(r.product_status),
      variantTitle: String(r.variant_title),
      sku: String(r.sku),
      imageKey: (r.image_key as string | null) ?? null,
      categoryPath: (r.category_path as string | null) ?? null,
      quantity: Number(r.quantity),
      unitPriceCents: Number(r.price_cents),
      addedPriceCents: r.added_price_cents === null ? null : Number(r.added_price_cents),
      onHand: Number(r.on_hand),
      reserved: Number(r.reserved),
      currency: String(r.currency),
    }));
  }

  async variant(variantId: string): Promise<VariantInfo | null> {
    const result = await this.db.tx().execute(sql`
      select v.id as variant_id, v.product_id, v.price_cents, p.status as product_status,
        coalesce(i.on_hand, 0) as on_hand, coalesce(i.reserved, 0) as reserved
      from product_variants v join products p on p.id = v.product_id left join inventory_items i on i.variant_id = v.id
      where v.id = ${variantId}`);
    const r = result.rows[0] as Record<string, unknown> | undefined;
    return r
      ? {
          variantId: String(r.variant_id),
          productId: String(r.product_id),
          priceCents: Number(r.price_cents),
          productStatus: String(r.product_status),
          onHand: Number(r.on_hand),
          reserved: Number(r.reserved),
        }
      : null;
  }

  async quantityOf(cartId: string, variantId: string) {
    const [row] = await this.db
      .tx()
      .select({ quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));
    return row?.quantity ?? 0;
  }

  async upsertItem(cartId: string, variantId: string, quantity: number, priceCents: number) {
    await this.db
      .tx()
      .insert(cartItems)
      .values({ cartId, variantId, tenantId: this.db.tenantId(), quantity, addedPriceCents: priceCents })
      .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.variantId], set: { quantity } });
  }

  async setQuantity(cartId: string, variantId: string, quantity: number) {
    const rows = await this.db
      .tx()
      .update(cartItems)
      .set({ quantity })
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)))
      .returning({ v: cartItems.variantId });
    return rows.length > 0;
  }

  async removeItem(cartId: string, variantId: string) {
    const rows = await this.db
      .tx()
      .delete(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)))
      .returning({ v: cartItems.variantId });
    return rows.length > 0;
  }

  async setDiscount(cartId: string, code: string | null) {
    await this.db.tx().update(carts).set({ discountCode: code }).where(eq(carts.id, cartId));
  }

  async setStatus(cartId: string, status: 'converted' | 'merged' | 'abandoned') {
    await this.db.tx().update(carts).set({ status, updatedAt: new Date() }).where(eq(carts.id, cartId));
  }

  async touch(cartId: string) {
    await this.db.tx().update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  }
}
