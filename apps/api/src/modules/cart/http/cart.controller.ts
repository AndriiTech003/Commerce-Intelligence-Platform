import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Res } from '@nestjs/common';
import {
  cartDiscountSchema,
  cartItemInputSchema,
  cartItemUpdateSchema,
  cartSchema,
  uuid,
  uuidv7,
} from '@cip/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import type { ApiConfig } from '../../../config';
import { Doc } from '../../../shared/http/doc';
import { ANON_COOKIE } from '../../../shared/http/request.middleware';
import { Storefront } from '../../../shared/http/surface';
import { ZBody, ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { CONFIG } from '../../../shared/tokens';
import { CartService } from '../application/cart.service';

@Controller('v1/storefront/cart')
export class CartController {
  constructor(
    @Inject(CartService) private readonly carts: CartService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private ensureAnonymousId(res: Response) {
    const ctx = currentContext();
    if (!ctx || ctx.anonymousId || ctx.actor?.type === 'customer') return;
    ctx.anonymousId = uuidv7();
    res.cookie(ANON_COOKIE, ctx.anonymousId, {
      httpOnly: false,
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE,
      path: '/',
      maxAge: 365 * 86400_000,
    });
    res.setHeader('X-Anonymous-Id', ctx.anonymousId);
  }

  @Get()
  @Storefront()
  @Doc({
    summary: 'Current cart (customer or anonymous_id); prices recalculated on every read',
    tags: ['cart'],
    response: cartSchema,
  })
  get(@Res({ passthrough: true }) res: Response) {
    this.ensureAnonymousId(res);
    return this.carts.get();
  }

  @Post('items')
  @Storefront()
  @HttpCode(200)
  @Doc({
    summary: 'Add a variant to the cart',
    tags: ['cart'],
    body: cartItemInputSchema,
    response: cartSchema,
  })
  add(
    @ZBody(cartItemInputSchema) body: z.infer<typeof cartItemInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.ensureAnonymousId(res);
    return this.carts.addItem(body.variantId, body.quantity);
  }

  @Patch('items/:variantId')
  @Storefront()
  @Doc({ summary: 'Change quantity', tags: ['cart'], body: cartItemUpdateSchema, response: cartSchema })
  update(
    @ZParam('variantId', uuid) variantId: string,
    @ZBody(cartItemUpdateSchema) body: z.infer<typeof cartItemUpdateSchema>,
  ) {
    return this.carts.updateItem(variantId, body.quantity);
  }

  @Delete('items/:variantId')
  @Storefront()
  @Doc({ summary: 'Remove an item', tags: ['cart'], response: cartSchema })
  remove(@ZParam('variantId', uuid) variantId: string) {
    return this.carts.removeItem(variantId);
  }

  @Post('discount')
  @Storefront()
  @HttpCode(200)
  @Doc({
    summary: 'Apply a promo code (422 DISCOUNT_INVALID with reason)',
    tags: ['cart'],
    body: cartDiscountSchema,
    response: cartSchema,
  })
  discount(@ZBody(cartDiscountSchema) body: z.infer<typeof cartDiscountSchema>) {
    return this.carts.applyDiscount(body.code);
  }

  @Delete('discount')
  @Storefront()
  @Doc({ summary: 'Remove the promo code', tags: ['cart'], response: cartSchema })
  removeDiscount() {
    return this.carts.removeDiscount();
  }
}
