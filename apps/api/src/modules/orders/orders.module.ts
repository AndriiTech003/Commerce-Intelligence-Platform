import { Global, Module } from '@nestjs/common';
import { OrderService } from './application/order.service';
import { ORDER_REPOSITORY } from './application/ports';
import { OrdersController } from './http/orders.controller';
import { DrizzleOrderRepository } from './infrastructure/order.repository';

@Global()
@Module({
  controllers: [OrdersController],
  providers: [{ provide: ORDER_REPOSITORY, useClass: DrizzleOrderRepository }, OrderService],
  exports: [OrderService],
})
export class OrdersModule {}
