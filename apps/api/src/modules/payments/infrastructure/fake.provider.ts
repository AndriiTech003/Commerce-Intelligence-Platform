import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { z } from 'zod';
import type { ApiConfig } from '../../../config';
import { CONFIG } from '../../../shared/tokens';
import {
  InvalidSignatureError,
  signatureHeader,
  verifySignatureHeader,
  type WebhookEvent,
} from '../domain/payment';
import type { FakeWebhookInput, PaymentProvider } from '../application/ports';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

const fakeEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  data: z.object({
    intentId: z.string(),
    tenantId: z.string().uuid(),
    orderId: z.string().uuid(),
    amountCents: z.number().int(),
  }),
});

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;

  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {}

  async createIntent() {
    const intentId = `pi_fake_${uuidv7().replace(/-/g, '')}`;
    return { intentId, clientSecret: `${intentId}_secret_${randomBytes(12).toString('hex')}` };
  }

  async refund(): Promise<void> {}

  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent {
    verifySignatureHeader(headers[FAKE_SIGNATURE_HEADER], this.config.FAKE_PAYMENT_WEBHOOK_SECRET, rawBody);
    let parsed: z.infer<typeof fakeEventSchema>;
    try {
      parsed = fakeEventSchema.parse(JSON.parse(rawBody));
    } catch {
      throw new InvalidSignatureError('Webhook payload is malformed');
    }
    return {
      eventId: parsed.id,
      kind: parsed.type === 'payment.succeeded' ? 'succeeded' : 'failed',
      intentId: parsed.data.intentId,
      tenantId: parsed.data.tenantId,
      amountCents: parsed.data.amountCents,
    };
  }

  buildWebhookBody(event: FakeWebhookInput): string {
    return JSON.stringify({
      id: `evt_fake_${uuidv7().replace(/-/g, '')}`,
      type: event.outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
      data: {
        intentId: event.intentId,
        tenantId: event.tenantId,
        orderId: event.orderId,
        amountCents: event.amountCents,
      },
    });
  }

  sign(body: string): string {
    return signatureHeader(this.config.FAKE_PAYMENT_WEBHOOK_SECRET, body);
  }
}
