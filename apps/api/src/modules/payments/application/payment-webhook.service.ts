import { counter } from '@cip/observability';
import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/errors';
import { OrderService } from '../../orders';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { PAYMENT_PROVIDER, PAYMENT_REPOSITORY, type PaymentProvider, type PaymentRepository } from './ports';

const paymentMetrics = {
  paid: counter('orders_paid_total', 'Orders paid (payment webhook succeeded)', ['currency']),
  revenue: counter('order_revenue_cents_total', 'Paid order revenue in minor units', ['currency']),
};

@Injectable()
export class PaymentWebhookService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async handleWebhook(providerName: string, rawBody: string, headers: Record<string, string | undefined>) {
    if (providerName !== this.provider.name) throw new NotFoundError('Payment provider', providerName);
    const event = this.provider.parseWebhook(rawBody, headers);
    if (event.kind === 'ignored' || !event.intentId || !event.tenantId)
      return { received: true, duplicate: false, outcome: 'ignored' };
    const intentId = event.intentId;
    let paidCents: number | null = null;
    let currency = 'unknown';
    const result = await this.uow.runForTenant(event.tenantId, async () => {
      const fresh = await this.repo.recordWebhook(this.provider.name, event.eventId);
      if (!fresh) return { received: true, duplicate: true, outcome: 'duplicate' };
      const payment = await this.repo.findByRef(this.provider.name, intentId, true);
      if (!payment) throw new NotFoundError('Payment', intentId);
      let outcome: string;
      if (event.kind === 'succeeded') {
        await this.repo.setStatus(payment.id, 'succeeded');
        outcome = await this.orders.markPaid(payment.orderId, event.amountCents ?? payment.amountCents);
        if (outcome === 'paid') {
          paidCents = event.amountCents ?? payment.amountCents;
          currency = (await this.orders.find(payment.orderId))?.currency ?? 'unknown';
        }
      } else {
        await this.repo.setStatus(payment.id, 'failed');
        outcome = await this.orders.markPaymentFailed(payment.orderId);
      }
      await this.repo.markWebhookProcessed(this.provider.name, event.eventId);
      return { received: true, duplicate: false, outcome };
    });
    if (paidCents !== null) {
      paymentMetrics.paid.inc({ currency });
      paymentMetrics.revenue.inc({ currency }, paidCents);
    }
    return result;
  }
}
