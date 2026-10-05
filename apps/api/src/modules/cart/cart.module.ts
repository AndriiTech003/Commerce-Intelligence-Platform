import { Global, Module } from '@nestjs/common';
import { CART_MERGER } from '../identity';
import { CartService } from './application/cart.service';
import { CART_REPOSITORY } from './application/ports';
import { CartController } from './http/cart.controller';
import { DrizzleCartRepository } from './infrastructure/cart.repository';

@Global()
@Module({
  controllers: [CartController],
  providers: [
    { provide: CART_REPOSITORY, useClass: DrizzleCartRepository },
    CartService,
    { provide: CART_MERGER, useExisting: CartService },
  ],
  exports: [CartService, CART_MERGER],
})
export class CartModule {}
