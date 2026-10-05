import { Global, Module } from '@nestjs/common';
import { DiscountService } from './application/discount.service';
import { DISCOUNT_REPOSITORY } from './application/ports';
import { DiscountsController } from './http/discounts.controller';
import { DrizzleDiscountRepository } from './infrastructure/discount.repository';

@Global()
@Module({
  controllers: [DiscountsController],
  providers: [{ provide: DISCOUNT_REPOSITORY, useClass: DrizzleDiscountRepository }, DiscountService],
  exports: [DiscountService],
})
export class DiscountsModule {}
