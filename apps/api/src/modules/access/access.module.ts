import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TRACKING_KEY_PROVISIONER } from '../identity';
import { AccessService } from './application/access.service';
import { ApiKeyService } from './application/api-key.service';
import { API_KEY_CACHE, API_KEY_REPOSITORY, STOREFRONT_RATE_LIMITER } from './application/ports';
import { ApiKeysController } from './http/api-keys.controller';
import { AuthGuard } from './http/auth.guard';
import { DrizzleApiKeyRepository } from './infrastructure/api-key.repository';
import { RedisApiKeyCache, RedisStorefrontRateLimiter } from './infrastructure/redis-adapters';
import { ApiKeyTrackingProvisioner } from './infrastructure/tracking-key.provisioner';

@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [
    { provide: API_KEY_REPOSITORY, useClass: DrizzleApiKeyRepository },
    { provide: API_KEY_CACHE, useClass: RedisApiKeyCache },
    { provide: STOREFRONT_RATE_LIMITER, useClass: RedisStorefrontRateLimiter },
    { provide: TRACKING_KEY_PROVISIONER, useClass: ApiKeyTrackingProvisioner },
    ApiKeyService,
    AccessService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [ApiKeyService, AccessService, TRACKING_KEY_PROVISIONER],
})
export class AccessModule {}
