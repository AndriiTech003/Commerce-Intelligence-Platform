import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type ShippingMethod } from '@cip/contracts';
import { counter } from '@cip/observability';
import type { ApiConfig } from '../../../config';
import { pgConstraint, pgErrorCode } from '../../../shared/pg';
import { currentContext } from '../../../shared/request-context';
import { CONFIG } from '../../../shared/tokens';
import { ATTRIBUTION_STORE, type AttributionStore } from '../../campaigns';
import { CartEmptyError, CartService } from '../../cart';
import { DiscountInvalidError, DiscountService } from '../../discounts';
import { InventoryService } from '../../inventory';
import { OrderService, type Order } from '../../orders';
import { PaymentService } from '../../payments';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { computeTotals } from '../domain/checkout';

const checkoutMetrics = {
  placed: counter('orders_placed_total', 'Orders placed at checkout', ['currency', 'attributed']),
  failures: counter('checkout_failures_total', 'Checkout failures', ['reason']),
};

export interface CheckoutInput {
  email: string;
  shippingAddress: Record<string, unknown>;
  shippingMethod: ShippingMethod;
  discountCode?: string | null | undefined;
}

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(CartService) private readonly carts: CartService,
    @Inject(DiscountService) private readonly discounts: DiscountService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(PaymentService) private readonly payments: PaymentService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(ATTRIBUTION_STORE) private readonly attribution: AttributionStore,
  ) {}

  private async lastClick(tenantId: string | null | undefined, profileIds: Array<string | null | undefined>) {
    if (!tenantId) return null;
    const ids = profileIds.filter((v): v is string => Boolean(v));
    const found = await this.attribution.lookup(tenantId, ids).catch(() => null);
    if (!found || Date.now() - Date.parse(found.clickedAt) > 24 * 3600_000) return null;
    return { ...found, model: 'last_click_24h' };
  }

  private async response(order: Order) {
    const payment = await this.payments.ensureIntent(order);
    return {
      orderId: order.id,
      number: order.number,
      status: order.status,
      totalCents: order.totalCents,
      currency: order.currency,
      payment,
    };
  }

  async checkout(input: CheckoutInput, idempotencyKey: string) {
    const ctx = currentContext();
    const customerId = ctx?.actor?.type === 'customer' ? ctx.actor.id : null;
    const attribution = await this.lastClick(ctx?.tenantId, [customerId, ctx?.anonymousId]);
    let created = false;
    try {
      const order = await this.uow.run(async () => {
        const existing = await this.orders.findByIdempotencyKey(idempotencyKey);
        if (existing) return existing;
        created = true;
        const cart = await this.carts.loadForCheckout();
        if (!cart) throw new CartEmptyError();
        const code = input.discountCode?.toUpperCase() ?? cart.discountCode;
        const priced = await this.carts.price(cart, { email: input.email, customerId }, code ?? null);
        if (priced.lines.length === 0) throw new CartEmptyError();
        if (code && !priced.discount)
          throw new DiscountInvalidError(priced.discountError ?? 'Unknown discount code');
        const orderId = uuidv7();
        await this.inventory.reserveForOrder(
          orderId,
          priced.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          new Date(Date.now() + this.config.RESERVATION_TTL_MINUTES * 60_000),
        );
        if (priced.discount) await this.discounts.redeem(priced.discount.id);
        const totals = computeTotals({
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discount?.amountCents ?? 0,
          shippingMethod: input.shippingMethod,
        });
        const placed = await this.orders.place({
          id: orderId,
          customerId,
          email: input.email,
          currency: priced.view.currency,
          ...totals,
          discountCode: priced.discount?.code ?? null,
          shippingAddress: { ...input.shippingAddress, method: input.shippingMethod },
          idempotencyKey,
          attribution,
          profileId: customerId ?? ctx?.anonymousId ?? orderId,
          items: priced.lines.map((l) => ({
            variantId: l.variantId,
            productId: l.productId,
            title: `${l.productTitle} — ${l.variantTitle}`,
            sku: l.sku,
            unitPriceCents: l.unitPriceCents,
            quantity: l.quantity,
            categoryPath: l.categoryPath,
          })),
        });
        await this.carts.markConverted(cart.id);
        return placed;
      });
      if (created)
        checkoutMetrics.placed.inc({ currency: order.currency, attributed: attribution ? 'yes' : 'no' });
      return this.response(order);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      checkoutMetrics.failures.inc({
        reason: typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'error',
      });
      if (pgErrorCode(error) === '23505' && pgConstraint(error) === 'orders_tenant_idempotency_unique') {
        const existing = await this.uow.run(() => this.orders.findByIdempotencyKey(idempotencyKey));
        if (existing) return this.response(existing);
      }
      throw error;
    }
  }
}
