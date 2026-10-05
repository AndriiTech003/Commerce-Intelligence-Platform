import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  inventoryAdjustSchema,
  inventoryItemSchema,
  inventoryMovementSchema,
  inventoryQuerySchema,
  pageSchema,
  uuid,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam, ZQuery } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { InventoryService } from '../application/inventory.service';

@Controller('v1/admin/inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get()
  @Admin('catalog:read')
  @Doc({
    summary: 'Stock levels with filters',
    tags: ['inventory'],
    query: inventoryQuerySchema,
    response: pageSchema(inventoryItemSchema),
  })
  list(@ZQuery(inventoryQuerySchema) query: z.infer<typeof inventoryQuerySchema>) {
    return this.inventory.list(query);
  }

  @Post(':variantId/adjust')
  @Admin('inventory:write')
  @HttpCode(200)
  @Audit('inventory.adjusted', 'variant')
  @Doc({ summary: 'Manual stock adjustment with a reason', tags: ['inventory'], body: inventoryAdjustSchema })
  async adjust(
    @ZParam('variantId', uuid) variantId: string,
    @ZBody(inventoryAdjustSchema) body: z.infer<typeof inventoryAdjustSchema>,
  ) {
    const result = await this.inventory.adjust(variantId, body.delta, body.reason);
    currentContext()?.audit.push({
      entityId: variantId,
      before: result.before,
      after: { onHand: result.after.onHand, reserved: result.after.reserved },
    });
    return { variantId, ...result.after };
  }

  @Get(':variantId/movements')
  @Admin('catalog:read')
  @Doc({
    summary: 'Stock movement history',
    tags: ['inventory'],
    response: z.object({ data: z.array(inventoryMovementSchema) }),
  })
  movements(@ZParam('variantId', uuid) variantId: string) {
    return this.inventory.movements(variantId);
  }
}
