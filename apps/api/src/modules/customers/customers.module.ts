import { Module } from '@nestjs/common';
import { CustomerService } from './application/customer.service';
import { CUSTOMER_QUERIES } from './application/ports';
import { CustomersController } from './http/customers.controller';
import { DrizzleCustomerQueries } from './infrastructure/customer.queries';

@Module({
  controllers: [CustomersController],
  providers: [{ provide: CUSTOMER_QUERIES, useClass: DrizzleCustomerQueries }, CustomerService],
  exports: [CustomerService],
})
export class CustomersModule {}
