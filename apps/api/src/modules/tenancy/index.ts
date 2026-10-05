export { TenancyModule } from './tenancy.module';
export { TenantService, type TenantSettingsView } from './application/tenant.service';
export { UNIT_OF_WORK, TENANT_REPOSITORY, type UnitOfWork, type TenantRepository } from './application/ports';
export { TenantDatabase, type Tx, type Database } from './infrastructure/tenant-database';
export {
  DEFAULT_SETTINGS,
  normalizeSettings,
  storeSlugFromHost,
  SlugTakenError,
  TenantNotFoundError,
  type Tenant,
  type TenantSettings,
} from './domain/tenant';
