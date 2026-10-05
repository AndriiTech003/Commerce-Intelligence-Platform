import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { NotFoundError, ValidationFailedError } from '../../../shared/errors';
import { pgErrorCode } from '../../../shared/pg';
import { currentContext } from '../../../shared/request-context';
import { DiscountInvalidError, DiscountService } from '../../discounts';
import type { CartMerger } from '../../identity';
import { IMAGE_STORAGE, type ImageStorage } from '../../catalog';
import { InsufficientStockError } from '../../inventory';
import { TenantService, UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { mergeQuantities, priceLines, ProductUnavailableError, type PricedLine } from '../domain/cart';
import { CART_REPOSITORY, type CartOwner, type CartRecord, type CartRepository } from './ports';

export interface CartView {
  id: string | null;
  currency: string;
  items: Array<{
    variantId: string;
    productId: string;
    productTitle: string;
    productSlug: string;
    variantTitle: string;
    sku: string;
    imageUrl: string | null;
    categoryPath: string | null;
    quantity: number;
    unitPriceCents: number;
    previousUnitPriceCents: number | null;
    priceChanged: boolean;
    lineTotalCents: number;
    available: number;
  }>;
  itemsCount: number;
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  discountError: string | null;
  totalCents: number;
}

export interface PricedCart {
  cart: CartRecord | null;
  lines: PricedLine[];
  subtotalCents: number;
  discount: { id: string; code: string; amountCents: number } | null;
  discountError: string | null;
  view: CartView;
}

@Injectable()
export class CartService implements CartMerger {
  constructor(
    @Inject(CART_REPOSITORY) private readonly repo: CartRepository,
    @Inject(DiscountService) private readonly discounts: DiscountService,
    @Inject(IMAGE_STORAGE) private readonly images: ImageStorage,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  owner(): CartOwner {
    const ctx = currentContext();
    const customerId = ctx?.actor?.type === 'customer' ? ctx.actor.id : null;
    const anonymousId = ctx?.anonymousId ?? null;
    if (!customerId && !anonymousId) throw new ValidationFailedError('Anonymous id cookie is required');
    return customerId ? { customerId, anonymousId: null } : { customerId: null, anonymousId };
  }

  private async getOrCreate(owner: CartOwner): Promise<CartRecord> {
    const existing = await this.repo.findActiveForUpdate(owner);
    if (existing) return existing;
    try {
      return await this.repo.create(uuidv7(), owner);
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        const again = await this.repo.findActiveForUpdate(owner);
        if (again) return again;
      }
      throw error;
    }
  }

  async price(
    cart: CartRecord | null,
    contact: { email: string | null; customerId: string | null },
    overrideCode?: string | null,
  ): Promise<PricedCart> {
    const tenant = await this.tenants.current();
    const raw = cart ? await this.repo.lines(cart.id) : [];
    const { lines, subtotalCents, itemsCount } = priceLines(raw);
    const code = overrideCode !== undefined ? overrideCode : (cart?.discountCode ?? null);
    let discount: PricedCart['discount'] = null;
    let discountError: string | null = null;
    if (code && lines.length > 0) {
      const result = await this.discounts.evaluate(code, { subtotalCents, ...contact });
      if (result.evaluation.ok && result.discount) {
        discount = {
          id: result.discount.id,
          code: result.discount.code,
          amountCents: result.evaluation.amountCents,
        };
      } else if (!result.evaluation.ok) {
        discountError = result.evaluation.reason;
      }
    }
    const discountCents = discount?.amountCents ?? 0;
    return {
      cart,
      lines,
      subtotalCents,
      discount,
      discountError,
      view: {
        id: cart?.id ?? null,
        currency: lines[0]?.currency ?? tenant.settings.currency,
        items: lines.map((l) => ({
          variantId: l.variantId,
          productId: l.productId,
          productTitle: l.productTitle,
          productSlug: l.productSlug,
          variantTitle: l.variantTitle,
          sku: l.sku,
          imageUrl: l.imageKey ? this.images.publicUrl(l.imageKey) : null,
          categoryPath: l.categoryPath,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          previousUnitPriceCents: l.previousUnitPriceCents,
          priceChanged: l.priceChanged,
          lineTotalCents: l.lineTotalCents,
          available: l.available,
        })),
        itemsCount,
        subtotalCents,
        discountCode: code,
        discountCents,
        discountError,
        totalCents: subtotalCents - discountCents,
      },
    };
  }

  private contact() {
    const actor = currentContext()?.actor;
    return { email: null, customerId: actor?.type === 'customer' ? actor.id : null };
  }

  async get(): Promise<CartView> {
    return this.uow.run(async () => {
      const cart = await this.repo.findActive(this.owner());
      return (await this.price(cart, this.contact())).view;
    });
  }

  async addItem(variantId: string, quantity: number): Promise<CartView> {
    return this.uow.run(async () => {
      const variant = await this.repo.variant(variantId);
      if (!variant || variant.productStatus !== 'active') throw new ProductUnavailableError(variantId);
      const cart = await this.getOrCreate(this.owner());
      const current = await this.repo.quantityOf(cart.id, variantId);
      const next = mergeQuantities(current, quantity);
      const available = variant.onHand - variant.reserved;
      if (next > available) {
        throw new InsufficientStockError([{ variantId, requested: next, available: Math.max(0, available) }]);
      }
      await this.repo.upsertItem(cart.id, variantId, next, variant.priceCents);
      await this.repo.touch(cart.id);
      return (await this.price(cart, this.contact())).view;
    });
  }

  async updateItem(variantId: string, quantity: number): Promise<CartView> {
    return this.uow.run(async () => {
      const cart = await this.repo.findActiveForUpdate(this.owner());
      if (!cart) throw new NotFoundError('Cart item', variantId);
      const variant = await this.repo.variant(variantId);
      if (variant && quantity > variant.onHand - variant.reserved) {
        throw new InsufficientStockError([
          { variantId, requested: quantity, available: Math.max(0, variant.onHand - variant.reserved) },
        ]);
      }
      if (!(await this.repo.setQuantity(cart.id, variantId, quantity)))
        throw new NotFoundError('Cart item', variantId);
      await this.repo.touch(cart.id);
      return (await this.price(cart, this.contact())).view;
    });
  }

  async removeItem(variantId: string): Promise<CartView> {
    return this.uow.run(async () => {
      const cart = await this.repo.findActiveForUpdate(this.owner());
      if (!cart || !(await this.repo.removeItem(cart.id, variantId)))
        throw new NotFoundError('Cart item', variantId);
      await this.repo.touch(cart.id);
      return (await this.price(cart, this.contact())).view;
    });
  }

  async applyDiscount(code: string): Promise<CartView> {
    return this.uow.run(async () => {
      const cart = await this.repo.findActiveForUpdate(this.owner());
      if (!cart) throw new DiscountInvalidError('Add items to the cart before applying a code');
      const priced = await this.price(cart, this.contact(), code.toUpperCase());
      if (!priced.discount) throw new DiscountInvalidError(priced.discountError ?? 'Unknown discount code');
      await this.repo.setDiscount(cart.id, priced.discount.code);
      return (await this.price({ ...cart, discountCode: priced.discount.code }, this.contact())).view;
    });
  }

  async removeDiscount(): Promise<CartView> {
    return this.uow.run(async () => {
      const cart = await this.repo.findActiveForUpdate(this.owner());
      if (cart) await this.repo.setDiscount(cart.id, null);
      return (await this.price(cart ? { ...cart, discountCode: null } : null, this.contact())).view;
    });
  }

  async mergeOnLogin(customerId: string, anonymousId: string | null): Promise<void> {
    if (!anonymousId) return;
    const anonymous = await this.repo.findActiveForUpdate({ customerId: null, anonymousId });
    if (!anonymous) return;
    const target = await this.getOrCreate({ customerId, anonymousId: null });
    const anonymousLines = await this.repo.lines(anonymous.id);
    for (const line of anonymousLines) {
      const current = await this.repo.quantityOf(target.id, line.variantId);
      await this.repo.upsertItem(
        target.id,
        line.variantId,
        mergeQuantities(current, line.quantity),
        line.addedPriceCents ?? line.unitPriceCents,
      );
    }
    if (anonymous.discountCode && !target.discountCode)
      await this.repo.setDiscount(target.id, anonymous.discountCode);
    await this.repo.setStatus(anonymous.id, 'merged');
    await this.repo.touch(target.id);
  }

  loadForCheckout(): Promise<CartRecord | null> {
    return this.repo.findActiveForUpdate(this.owner());
  }

  markConverted(cartId: string): Promise<void> {
    return this.repo.setStatus(cartId, 'converted');
  }
}
