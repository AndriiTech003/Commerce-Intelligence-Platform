import { Global, Module } from '@nestjs/common';
import type { ApiConfig } from '../../config';
import { CONFIG } from '../../shared/tokens';
import { PAYMENT_GATEWAY } from '../orders';
import { PaymentWebhookService } from './application/payment-webhook.service';
import { PaymentService } from './application/payment.service';
import { FAKE_PAYMENT_SIMULATOR, PAYMENT_PROVIDER, PAYMENT_REPOSITORY } from './application/ports';
import { PaymentsController } from './http/payments.controller';
import { FakeWebhookDispatcher } from './infrastructure/fake-webhook.dispatcher';
import { FakePaymentProvider } from './infrastructure/fake.provider';
import { DrizzlePaymentRepository } from './infrastructure/payment.repository';
import { StripePaymentProvider } from './infrastructure/stripe.provider';

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [
    FakePaymentProvider,
    StripePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: ApiConfig, fake: FakePaymentProvider, stripe: StripePaymentProvider) =>
        config.PAYMENT_PROVIDER === 'stripe' ? stripe : fake,
      inject: [CONFIG, FakePaymentProvider, StripePaymentProvider],
    },
    FakeWebhookDispatcher,
    { provide: FAKE_PAYMENT_SIMULATOR, useExisting: FakeWebhookDispatcher },
    { provide: PAYMENT_REPOSITORY, useClass: DrizzlePaymentRepository },
    PaymentService,
    PaymentWebhookService,
    { provide: PAYMENT_GATEWAY, useExisting: PaymentService },
  ],
  exports: [PaymentService, PAYMENT_GATEWAY, FakePaymentProvider, FakeWebhookDispatcher],
})
export class PaymentsModule {}
