import { Global, Module } from '@nestjs/common';
import { TENANT_REPOSITORY, UNIT_OF_WORK } from './application/ports';
import { TenantService } from './application/tenant.service';
import { SettingsController } from './http/settings.controller';
import { TenantDatabase } from './infrastructure/tenant-database';
import { DrizzleTenantRepository } from './infrastructure/tenant.repository';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [
    TenantDatabase,
    { provide: UNIT_OF_WORK, useExisting: TenantDatabase },
    { provide: TENANT_REPOSITORY, useClass: DrizzleTenantRepository },
    TenantService,
  ],
  exports: [TenantDatabase, UNIT_OF_WORK, TENANT_REPOSITORY, TenantService],
})
export class TenancyModule {}
