import { Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { fakeConfirmSchema } from '@cip/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Public, Storefront } from '../../../shared/http/surface';
import { ZBody } from '../../../shared/http/zod';
import { PaymentWebhookService } from '../application/payment-webhook.service';
import { PaymentService } from '../application/payment.service';

const webhookResult = z.object({ received: z.boolean(), duplicate: z.boolean(), outcome: z.string() });

@Controller('v1/payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentService) private readonly payments: PaymentService,
    @Inject(PaymentWebhookService) private readonly webhooks: PaymentWebhookService,
  ) {}

  @Post('webhooks/:provider')
  @Public()
  @HttpCode(200)
  @Doc({
    summary: 'Payment provider webhook: signature check, idempotent by provider_event_id',
    tags: ['payments'],
    response: webhookResult,
  })
  webhook(@Param('provider') provider: string, @Req() req: Request) {
    const raw =
      (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]),
    ) as Record<string, string | undefined>;
    return this.webhooks.handleWebhook(provider, raw, headers);
  }

  @Post('fake/:intentId/confirm')
  @Storefront()
  @HttpCode(202)
  @Doc({
    summary:
      'FakePaymentProvider only: confirm with a test card (4242… succeeds, 4000…0002 fails); webhook follows asynchronously',
    tags: ['payments'],
    body: fakeConfirmSchema,
    response: z.object({ intentId: z.string(), status: z.literal('processing'), orderId: z.string() }),
    status: 202,
  })
  confirm(
    @Param('intentId') intentId: string,
    @ZBody(fakeConfirmSchema) body: z.infer<typeof fakeConfirmSchema>,
  ) {
    return this.payments.confirmFake(intentId, body.cardNumber);
  }
}
