import { Controller, Delete, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { discountCreateSchema, discountSchema, discountUpdateSchema, uuid } from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { DiscountService } from '../application/discount.service';

@Controller('v1/admin/discounts')
export class DiscountsController {
  constructor(@Inject(DiscountService) private readonly discounts: DiscountService) {}

  @Get()
  @Admin('catalog:read')
  @Doc({
    summary: 'Discount codes',
    tags: ['discounts'],
    response: z.object({ data: z.array(discountSchema) }),
  })
  list() {
    return this.discounts.list();
  }

  @Post()
  @Admin('catalog:write')
  @Audit('discount.created', 'discount')
  @Doc({
    summary: 'Create a discount code',
    tags: ['discounts'],
    body: discountCreateSchema,
    response: discountSchema,
    status: 201,
  })
  async create(@ZBody(discountCreateSchema) body: z.infer<typeof discountCreateSchema>) {
    const created = await this.discounts.create(body);
    currentContext()?.audit.push({ entityId: created.id, before: null, after: { ...created } });
    return created;
  }

  @Patch(':id')
  @Admin('catalog:write')
  @Audit('discount.updated', 'discount')
  @Doc({
    summary: 'Update a discount code',
    tags: ['discounts'],
    body: discountUpdateSchema,
    response: discountSchema,
  })
  async update(
    @ZParam('id', uuid) id: string,
    @ZBody(discountUpdateSchema) body: z.infer<typeof discountUpdateSchema>,
  ) {
    const { before, after } = await this.discounts.update(id, body);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: { ...after } });
    return after;
  }

  @Delete(':id')
  @Admin('catalog:write')
  @Audit('discount.deleted', 'discount')
  @HttpCode(204)
  @Doc({ summary: 'Delete a discount code', tags: ['discounts'], status: 204 })
  async remove(@ZParam('id', uuid) id: string) {
    const before = await this.discounts.remove(id);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: null });
  }
}
