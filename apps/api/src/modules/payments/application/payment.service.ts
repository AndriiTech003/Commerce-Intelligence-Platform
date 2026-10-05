import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { NotFoundError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import type { Order, PaymentGateway } from '../../orders';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { fakeCardOutcome, PaymentDeclinedError } from '../domain/payment';
import {
  FAKE_PAYMENT_SIMULATOR,
  PAYMENT_PROVIDER,
  PAYMENT_REPOSITORY,
  type FakePaymentSimulator,
  type PaymentProvider,
  type PaymentRepository,
} from './ports';

@Injectable()
export class PaymentService implements PaymentGateway {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository,
    @Inject(FAKE_PAYMENT_SIMULATOR) private readonly simulator: FakePaymentSimulator,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  async ensureIntent(order: Order): Promise<{ provider: string; intentId: string; clientSecret: string }> {
    const tenantId = currentContext()!.tenantId!;
    const existing = await this.uow.run(() => this.repo.findLatestForOrder(order.id));
    if (existing)
      return {
        provider: existing.provider,
        intentId: existing.providerRef,
        clientSecret: existing.clientSecret ?? '',
      };
    const intent = await this.provider.createIntent({
      orderId: order.id,
      tenantId,
      amountCents: order.totalCents,
      currency: order.currency,
      email: order.email,
    });
    await this.uow.run(() =>
      this.repo.insert({
        id: uuidv7(),
        orderId: order.id,
        provider: this.provider.name,
        providerRef: intent.intentId,
        clientSecret: intent.clientSecret,
        status: 'requires_action',
        amountCents: order.totalCents,
      }),
    );
    return { provider: this.provider.name, ...intent };
  }

  async confirmFake(intentId: string, cardNumber: string) {
    if (this.provider.name !== 'fake') throw new NotFoundError('Fake payment intent', intentId);
    const tenantId = currentContext()!.tenantId!;
    const { result, webhook } = await this.uow.run(async () => {
      const payment = await this.repo.findByRef('fake', intentId, true);
      if (!payment) throw new NotFoundError('Payment intent', intentId);
      if (payment.status !== 'requires_action')
        throw new PaymentDeclinedError(`Payment is already ${payment.status}`);
      const outcome = fakeCardOutcome(cardNumber);
      await this.repo.setStatus(payment.id, 'processing');
      const scheduled = await this.simulator.scheduleWebhook({
        intentId,
        tenantId,
        orderId: payment.orderId,
        amountCents: payment.amountCents,
        outcome,
      });
      return {
        result: { intentId, status: 'processing' as const, orderId: payment.orderId },
        webhook: scheduled,
      };
    });
    this.simulator.wake(webhook.id, webhook.dueInMs);
    return result;
  }

  async refund(orderId: string, amountCents: number): Promise<void> {
    const payment = await this.repo.findLatestForOrder(orderId);
    if (!payment) throw new NotFoundError('Payment for order', orderId);
    if (payment.status === 'refunded') return;
    await this.provider.refund(payment.providerRef, amountCents);
    await this.repo.setStatus(payment.id, 'refunded');
  }
}
