import type { CartLine } from '../domain/cart';

export const CART_REPOSITORY = Symbol('CART_REPOSITORY');

export interface CartOwner {
  customerId: string | null;
  anonymousId: string | null;
}

export interface CartRecord {
  id: string;
  customerId: string | null;
  anonymousId: string | null;
  discountCode: string | null;
}

export interface VariantInfo {
  variantId: string;
  productId: string;
  priceCents: number;
  productStatus: string;
  onHand: number;
  reserved: number;
}

export interface CartRepository {
  findActive(owner: CartOwner): Promise<CartRecord | null>;
  findActiveForUpdate(owner: CartOwner): Promise<CartRecord | null>;
  create(id: string, owner: CartOwner): Promise<CartRecord>;
  lines(cartId: string): Promise<CartLine[]>;
  variant(variantId: string): Promise<VariantInfo | null>;
  quantityOf(cartId: string, variantId: string): Promise<number>;
  upsertItem(cartId: string, variantId: string, quantity: number, priceCents: number): Promise<void>;
  setQuantity(cartId: string, variantId: string, quantity: number): Promise<boolean>;
  removeItem(cartId: string, variantId: string): Promise<boolean>;
  setDiscount(cartId: string, code: string | null): Promise<void>;
  setStatus(cartId: string, status: 'converted' | 'merged' | 'abandoned'): Promise<void>;
  touch(cartId: string): Promise<void>;
}
