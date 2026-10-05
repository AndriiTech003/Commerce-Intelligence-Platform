import { Global, Module } from '@nestjs/common';
import { InventoryService } from './application/inventory.service';
import { INVENTORY_REPOSITORY } from './application/ports';
import { InventoryController } from './http/inventory.controller';
import { DrizzleInventoryRepository } from './infrastructure/inventory.repository';

@Global()
@Module({
  controllers: [InventoryController],
  providers: [{ provide: INVENTORY_REPOSITORY, useClass: DrizzleInventoryRepository }, InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
