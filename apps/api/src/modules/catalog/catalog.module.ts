import { Global, Module } from '@nestjs/common';
import { DEMO_CATALOG_PROVISIONER } from '../identity';
import { CatalogService } from './application/catalog.service';
import { DemoCatalogService } from './application/demo-catalog.service';
import { ProductImportService } from './application/import.service';
import { CATALOG_REPOSITORY, IMAGE_STORAGE, STOREFRONT_REVALIDATOR } from './application/ports';
import { CatalogAdminController } from './http/catalog-admin.controller';
import { CatalogStorefrontController } from './http/catalog-storefront.controller';
import { HttpStorefrontRevalidator, S3ImageStorage } from './infrastructure/adapters';
import { DrizzleCatalogRepository } from './infrastructure/catalog.repository';

@Global()
@Module({
  controllers: [CatalogAdminController, CatalogStorefrontController],
  providers: [
    { provide: CATALOG_REPOSITORY, useClass: DrizzleCatalogRepository },
    { provide: IMAGE_STORAGE, useClass: S3ImageStorage },
    { provide: STOREFRONT_REVALIDATOR, useClass: HttpStorefrontRevalidator },
    CatalogService,
    DemoCatalogService,
    ProductImportService,
    { provide: DEMO_CATALOG_PROVISIONER, useExisting: DemoCatalogService },
  ],
  exports: [CatalogService, DemoCatalogService, DEMO_CATALOG_PROVISIONER, IMAGE_STORAGE],
})
export class CatalogModule {}
