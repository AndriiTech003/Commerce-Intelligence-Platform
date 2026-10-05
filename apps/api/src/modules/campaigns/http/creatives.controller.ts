import { Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import {
  creativeReviewSchema,
  creativeSchema,
  creativeUpdateSchema,
  reviewQueueItemSchema,
  uuid,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { CreativeService } from '../application/creative.service';

@Controller('v1/admin')
export class CreativesController {
  constructor(@Inject(CreativeService) private readonly creatives: CreativeService) {}

  @Get('creatives/review-queue')
  @Admin('marketing:approve')
  @Doc({
    summary: 'Draft creatives waiting for review, with guardrail flags',
    tags: ['campaigns'],
    response: z.object({ data: z.array(reviewQueueItemSchema) }),
  })
  queue() {
    return this.creatives.reviewQueue();
  }

  @Patch('creatives/:id')
  @Admin('marketing:write')
  @Audit('creative.updated', 'creative')
  @Doc({
    summary: 'Edit a draft (guardrails re-run) or switch an approved creative between active and paused',
    tags: ['campaigns'],
    body: creativeUpdateSchema,
    response: creativeSchema,
  })
  async update(
    @ZParam('id', uuid) id: string,
    @ZBody(creativeUpdateSchema) body: z.infer<typeof creativeUpdateSchema>,
  ) {
    const { before, after } = await this.creatives.update(id, body);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: { ...after } });
    return after;
  }

  @Post('creatives/:id/review')
  @Admin('marketing:approve')
  @Audit('creative.reviewed', 'creative')
  @HttpCode(200)
  @Doc({
    summary: 'Approve or reject a draft (permission marketing:approve)',
    tags: ['campaigns'],
    body: creativeReviewSchema,
    response: creativeSchema,
  })
  async review(
    @ZParam('id', uuid) id: string,
    @ZBody(creativeReviewSchema) body: z.infer<typeof creativeReviewSchema>,
  ) {
    const { before, after } = await this.creatives.review(id, body.decision, body.comment);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: { ...after } });
    return after;
  }

  @Get('features')
  @Admin()
  @Doc({
    summary: 'Feature flags and AI usage for the current store',
    tags: ['campaigns'],
    response: z.object({
      aiCreatives: z.boolean(),
      flags: z.object({ source: z.string(), initialized: z.boolean(), relay: z.string().nullable() }),
      llm: z.object({
        provider: z.string(),
        model: z.string(),
        usedToday: z.number(),
        dailyLimit: z.number(),
      }),
    }),
  })
  features() {
    return this.creatives.usage();
  }
}
