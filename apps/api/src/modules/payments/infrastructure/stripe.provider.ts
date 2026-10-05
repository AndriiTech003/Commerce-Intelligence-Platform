import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../config';
import { ServiceUnavailableError } from '../../../shared/errors';
import { CONFIG } from '../../../shared/tokens';
import { InvalidSignatureError, verifySignatureHeader, type WebhookEvent } from '../domain/payment';
import type { PaymentProvider } from '../application/ports';

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: { id?: string; amount?: number; amount_received?: number; metadata?: Record<string, string> };
  };
}

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {}

  private async call(path: string, params: Record<string, string>) {
    if (!this.config.STRIPE_SECRET_KEY) throw new ServiceUnavailableError('Stripe is not configured');
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': `${path}:${params['metadata[order_id]'] ?? params.payment_intent ?? ''}`,
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new ServiceUnavailableError(`Stripe error: ${JSON.stringify(json.error ?? json)}`);
    return json;
  }

  async createIntent(input: {
    orderId: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    email: string;
  }) {
    const json = await this.call('payment_intents', {
      amount: String(input.amountCents),
      currency: input.currency.toLowerCase(),
      receipt_email: input.email,
      'automatic_payment_methods[enabled]': 'true',
      'metadata[order_id]': input.orderId,
      'metadata[tenant_id]': input.tenantId,
    });
    return { intentId: String(json.id), clientSecret: String(json.client_secret) };
  }

  async refund(intentId: string, amountCents: number) {
    await this.call('refunds', { payment_intent: intentId, amount: String(amountCents) });
  }

  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent {
    if (!this.config.STRIPE_WEBHOOK_SECRET)
      throw new InvalidSignatureError('Stripe webhook secret is not configured');
    verifySignatureHeader(headers['stripe-signature'], this.config.STRIPE_WEBHOOK_SECRET, rawBody);
    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      throw new InvalidSignatureError('Webhook payload is malformed');
    }
    const object = event.data?.object ?? {};
    const kind =
      event.type === 'payment_intent.succeeded'
        ? 'succeeded'
        : event.type === 'payment_intent.payment_failed'
          ? 'failed'
          : 'ignored';
    return {
      eventId: event.id,
      kind,
      intentId: object.id ?? null,
      tenantId: object.metadata?.tenant_id ?? null,
      amountCents: object.amount_received ?? object.amount ?? null,
    };
  }
}
