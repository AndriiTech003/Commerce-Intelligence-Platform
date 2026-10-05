import type { PaymentStatus, WebhookEvent } from '../domain/payment';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
export const FAKE_PAYMENT_SIMULATOR = Symbol('FAKE_PAYMENT_SIMULATOR');

export interface PaymentProvider {
  readonly name: 'fake' | 'stripe';
  createIntent(input: {
    orderId: string;
    tenantId: string;
    amountCents: number;
    currency: string;
    email: string;
  }): Promise<{
    intentId: string;
    clientSecret: string;
  }>;
  refund(intentId: string, amountCents: number): Promise<void>;
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  provider: string;
  providerRef: string;
  clientSecret: string | null;
  status: PaymentStatus;
  amountCents: number;
}

export interface PaymentRepository {
  insert(record: PaymentRecord): Promise<void>;
  findByRef(provider: string, ref: string, forUpdate: boolean): Promise<PaymentRecord | null>;
  findLatestForOrder(orderId: string): Promise<PaymentRecord | null>;
  setStatus(id: string, status: PaymentStatus): Promise<void>;
  recordWebhook(provider: string, eventId: string): Promise<boolean>;
  markWebhookProcessed(provider: string, eventId: string): Promise<void>;
}

export interface FakeWebhookInput {
  intentId: string;
  tenantId: string;
  orderId: string;
  amountCents: number;
  outcome: 'succeeded' | 'failed';
}

export interface FakePaymentSimulator {
  scheduleWebhook(event: FakeWebhookInput): Promise<{ id: string; dueInMs: number }>;
  wake(id: string, dueInMs: number): void;
}
