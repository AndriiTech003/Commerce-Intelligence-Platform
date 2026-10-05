import { Controller, Get, Inject, Patch } from '@nestjs/common';
import {
  SHIPPING_METHODS,
  SHIPPING_RATES,
  storeInfoSchema,
  tenantSettingsSchema,
  tenantSettingsUpdateSchema,
} from '@cip/contracts';
import type { z } from 'zod';
import { currentContext } from '../../../shared/request-context';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit, Storefront } from '../../../shared/http/surface';
import { ZBody } from '../../../shared/http/zod';
import { TenantService } from '../application/tenant.service';

@Controller()
export class SettingsController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Get('v1/admin/settings')
  @Admin()
  @Doc({ summary: 'Store settings', tags: ['tenancy'], response: tenantSettingsSchema })
  async get() {
    return this.tenants.view(await this.tenants.current());
  }

  @Patch('v1/admin/settings')
  @Admin('settings:write')
  @Audit('settings.updated', 'tenant')
  @Doc({
    summary: 'Update store settings',
    tags: ['tenancy'],
    body: tenantSettingsUpdateSchema,
    response: tenantSettingsSchema,
  })
  async update(@ZBody(tenantSettingsUpdateSchema) body: z.infer<typeof tenantSettingsUpdateSchema>) {
    const { before, after } = await this.tenants.updateSettings(body);
    const ctx = currentContext();
    ctx?.audit.push({ entityId: ctx.tenantId, before: { ...before }, after: { ...after } });
    return after;
  }

  @Get('v1/storefront/store')
  @Storefront()
  @Doc({
    summary: 'Store branding, tracking key and shipping methods',
    tags: ['storefront'],
    response: storeInfoSchema,
  })
  async store() {
    const tenant = await this.tenants.current();
    return {
      ...this.tenants.storeInfo(tenant),
      shippingMethods: SHIPPING_METHODS.map((id) => ({ id, ...SHIPPING_RATES[id] })),
    };
  }
}
