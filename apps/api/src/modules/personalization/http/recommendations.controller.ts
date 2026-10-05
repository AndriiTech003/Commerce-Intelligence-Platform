import { Controller, Get, Header, Inject } from '@nestjs/common';
import { recommendationQuerySchema, recommendationResponseSchema } from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Storefront } from '../../../shared/http/surface';
import { ZQuery } from '../../../shared/http/zod';
import { ValidationFailedError } from '../../../shared/errors';
import { RecommendationService } from '../application/recommendation.service';

@Controller('v1/storefront/recommendations')
export class RecommendationsController {
  constructor(@Inject(RecommendationService) private readonly recommendations: RecommendationService) {}

  @Get()
  @Storefront()
  @Header('Cache-Control', 'no-store')
  @Doc({
    summary:
      'Personalized recommendations: for_you, similar, bought_together, cart_upsell (contributions per product)',
    tags: ['storefront'],
    query: recommendationQuerySchema,
    response: recommendationResponseSchema,
  })
  get(@ZQuery(recommendationQuerySchema) query: z.infer<typeof recommendationQuerySchema>) {
    if ((query.type === 'similar' || query.type === 'bought_together') && !query.productId)
      throw new ValidationFailedError(`productId is required for type=${query.type}`);
    return this.recommendations.recommend(query);
  }
}
