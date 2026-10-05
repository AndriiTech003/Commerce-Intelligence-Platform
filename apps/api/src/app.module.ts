import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { Logger } from '@cip/observability';
import type { ApiConfig } from './config';
import { AccessModule } from './modules/access';
import { AnalyticsModule } from './modules/analytics';
import { AuditModule } from './modules/audit';
import { CampaignsModule } from './modules/campaigns';
import { CartModule } from './modules/cart';
import { CatalogModule } from './modules/catalog';
import { CheckoutModule } from './modules/checkout';
import { CustomersModule } from './modules/customers';
import { DiscountsModule } from './modules/discounts';
import { ExperimentsModule } from './modules/experiments';
import { IdentityModule } from './modules/identity';
import { InventoryModule } from './modules/inventory';
import { JobsModule } from './modules/jobs';
import { OrdersModule } from './modules/orders';
import { OutboxModule } from './modules/outbox';
import { PaymentsModule } from './modules/payments';
import { PersonalizationModule } from './modules/personalization';
import { PlatformModule } from './modules/platform';
import { SimulatorControlModule } from './modules/simulator-control';
import { TenancyModule } from './modules/tenancy';
import { WebhooksModule } from './modules/webhooks';
import { DocsController, registerDocumentedModules } from './shared/http/docs.controller';
import { HealthController } from './shared/http/health.controller';
import { IdempotencyInterceptor } from './shared/http/idempotency.interceptor';
import { ProblemDetailsFilter } from './shared/http/problem.filter';
import { SharedModule } from './shared/infrastructure/shared.module';

export const FEATURE_MODULES = [
  TenancyModule,
  OutboxModule,
  IdentityModule,
  AccessModule,
  AuditModule,
  JobsModule,
  InventoryModule,
  CatalogModule,
  DiscountsModule,
  CartModule,
  OrdersModule,
  PaymentsModule,
  CheckoutModule,
  AnalyticsModule,
  PersonalizationModule,
  CustomersModule,
  PlatformModule,
  SimulatorControlModule,
  CampaignsModule,
  ExperimentsModule,
  WebhooksModule,
];

@Module({})
export class AppModule {
  static forRoot(config: ApiConfig, logger: Logger): DynamicModule {
    registerDocumentedModules(FEATURE_MODULES, [HealthController]);
    return {
      module: AppModule,
      imports: [SharedModule.forRoot(config, logger), ...FEATURE_MODULES],
      controllers: [HealthController, DocsController],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }
}
