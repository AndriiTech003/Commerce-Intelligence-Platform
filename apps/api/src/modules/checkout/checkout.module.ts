import { Module } from '@nestjs/common';
import { CheckoutService } from './application/checkout.service';
import { CheckoutController } from './http/checkout.controller';

@Module({
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
