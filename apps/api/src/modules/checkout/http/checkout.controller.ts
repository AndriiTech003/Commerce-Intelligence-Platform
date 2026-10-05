import { Controller, Headers, Inject, Post } from '@nestjs/common';
import { checkoutResponseSchema, checkoutSchema } from '@cip/contracts';
import type { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Idempotent, Storefront } from '../../../shared/http/surface';
import { ZBody } from '../../../shared/http/zod';
import { CheckoutService } from '../application/checkout.service';

@Controller('v1/storefront/checkout')
export class CheckoutController {
  constructor(@Inject(CheckoutService) private readonly checkout: CheckoutService) {}

  @Post()
  @Storefront()
  @Idempotent({ required: true })
  @Doc({
    summary:
      'Place an order: atomic stock reservation (variant_id order), order number, outbox order.placed, payment intent',
    tags: ['checkout'],
    body: checkoutSchema,
    response: checkoutResponseSchema,
    status: 201,
    headers: [
      {
        name: 'Idempotency-Key',
        required: true,
        description: 'One key per checkout attempt; same key + same body replays',
      },
    ],
  })
  place(
    @ZBody(checkoutSchema) body: z.infer<typeof checkoutSchema>,
    @Headers('idempotency-key') key: string,
  ) {
    return this.checkout.checkout(body, key.trim());
  }
}
