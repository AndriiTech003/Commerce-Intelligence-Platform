import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  cohortsQuerySchema,
  cohortsSchema,
  funnelSchema,
  insightSchema,
  liveSnapshotSchema,
  overviewQuerySchema,
  overviewSchema,
  periodQuerySchema,
  realtimeTicketSchema,
  timeseriesQuerySchema,
  timeseriesSchema,
  topProductsQuerySchema,
  topProductsSchema,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin } from '../../../shared/http/surface';
import { ZQuery } from '../../../shared/http/zod';
import { AnalyticsService } from '../application/analytics.service';
import { InsightsService } from '../application/insights.service';

const insightsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@Controller('v1/admin')
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(InsightsService) private readonly insightsService: InsightsService,
  ) {}

  @Get('analytics/insights')
  @Admin('analytics:read')
  @Doc({
    summary: 'AI Insights: aggregates only → LLM → observations that cite the numbers they use (cached 1 h)',
    tags: ['analytics'],
    query: insightsQuery,
    response: insightSchema,
  })
  insights(@ZQuery(insightsQuery) query: z.infer<typeof insightsQuery>) {
    return this.insightsService.insights({ days: query.days, refresh: query.refresh });
  }

  @Get('analytics/overview')
  @Admin('analytics:read')
  @Doc({
    summary: 'Revenue, orders, AOV, conversion and visitors with delta vs previous period',
    tags: ['analytics'],
    query: overviewQuerySchema,
    response: overviewSchema,
  })
  overview(@ZQuery(overviewQuerySchema) query: z.infer<typeof overviewQuerySchema>) {
    return this.analytics.overview(query);
  }

  @Get('analytics/timeseries')
  @Admin('analytics:read')
  @Doc({
    summary: 'Time series for charts',
    tags: ['analytics'],
    query: timeseriesQuerySchema,
    response: timeseriesSchema,
  })
  timeseries(@ZQuery(timeseriesQuerySchema) query: z.infer<typeof timeseriesQuerySchema>) {
    return this.analytics.timeseries(query);
  }

  @Get('analytics/funnel')
  @Admin('analytics:read')
  @Doc({
    summary: 'Funnel product_viewed → cart_item_added → checkout_started → order_placed (windowFunnel 1h)',
    tags: ['analytics'],
    query: periodQuerySchema,
    response: funnelSchema,
  })
  funnel(@ZQuery(periodQuerySchema) query: z.infer<typeof periodQuerySchema>) {
    return this.analytics.funnel(query);
  }

  @Get('analytics/live/funnel')
  @Admin('analytics:read')
  @Doc({ summary: 'Funnel for the last hour (live dashboard)', tags: ['analytics'], response: funnelSchema })
  liveFunnel() {
    return this.analytics.funnel({}, true);
  }

  @Get('analytics/top-products')
  @Admin('analytics:read')
  @Doc({
    summary: 'Top products by revenue, views, purchases or add-to-cart',
    tags: ['analytics'],
    query: topProductsQuerySchema,
    response: topProductsSchema,
  })
  topProducts(@ZQuery(topProductsQuerySchema) query: z.infer<typeof topProductsQuerySchema>) {
    return this.analytics.topProducts(query);
  }

  @Get('analytics/cohorts')
  @Admin('analytics:read')
  @Doc({
    summary: 'Weekly retention cohorts',
    tags: ['analytics'],
    query: cohortsQuerySchema,
    response: cohortsSchema,
  })
  cohorts(@ZQuery(cohortsQuerySchema) query: z.infer<typeof cohortsQuerySchema>) {
    return this.analytics.cohorts(query);
  }

  @Get('analytics/live')
  @Admin('analytics:read')
  @Doc({
    summary: 'Live snapshot from Redis (initial load and resync after reconnect)',
    tags: ['analytics'],
    response: liveSnapshotSchema,
  })
  live() {
    return this.analytics.liveSnapshot();
  }

  @Post('realtime/ticket')
  @Admin('analytics:read')
  @HttpCode(201)
  @Doc({
    summary: 'Short-lived ticket for the realtime WebSocket gateway',
    tags: ['analytics'],
    response: realtimeTicketSchema,
    status: 201,
  })
  ticket() {
    return this.analytics.realtimeTicket();
  }
}
