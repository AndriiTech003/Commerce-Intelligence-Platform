import { Global, Module } from '@nestjs/common';
import { AnalyticsService } from './application/analytics.service';
import { InsightsService } from './application/insights.service';
import { ANALYTICS_CACHE, ANALYTICS_STORE, LIVE_METRICS, PRODUCT_TITLES } from './application/ports';
import { AnalyticsController } from './http/analytics.controller';
import { ClickHouseAnalyticsStore } from './infrastructure/clickhouse.store';
import { DrizzleProductTitles } from './infrastructure/product-titles';
import { RedisAnalyticsCache, RedisLiveMetrics } from './infrastructure/redis-live';

@Global()
@Module({
  controllers: [AnalyticsController],
  providers: [
    { provide: ANALYTICS_STORE, useClass: ClickHouseAnalyticsStore },
    { provide: LIVE_METRICS, useClass: RedisLiveMetrics },
    { provide: ANALYTICS_CACHE, useClass: RedisAnalyticsCache },
    { provide: PRODUCT_TITLES, useClass: DrizzleProductTitles },
    AnalyticsService,
    InsightsService,
  ],
  exports: [AnalyticsService, InsightsService],
})
export class AnalyticsModule {}
