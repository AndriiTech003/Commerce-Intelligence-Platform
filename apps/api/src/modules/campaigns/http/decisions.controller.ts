import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { decisionQuerySchema, decisionResponseSchema, explanationSchema, uuid } from '@cip/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../../shared/errors';
import { Doc } from '../../../shared/http/doc';
import { Storefront } from '../../../shared/http/surface';
import { ZParam, ZQuery } from '../../../shared/http/zod';
import { currentProfileId } from '../../personalization';
import { DecisionService } from '../application/decision.service';

@Controller('v1/storefront/decisions')
export class DecisionsController {
  constructor(@Inject(DecisionService) private readonly decisions: DecisionService) {}

  @Get()
  @Storefront()
  @Header('Cache-Control', 'no-store')
  @Doc({
    summary:
      'Personalized campaign block for a placement: creative chosen by Thompson sampling + ranked products; 204 when no campaign is live',
    tags: ['storefront'],
    query: decisionQuerySchema,
    response: decisionResponseSchema,
  })
  async decide(
    @ZQuery(decisionQuerySchema) query: z.infer<typeof decisionQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const decision = await this.decisions.decide(query);
    if (!decision) {
      res.status(204);
      return undefined;
    }
    return decision;
  }

  @Get(':id/explanation')
  @Storefront()
  @Header('Cache-Control', 'no-store')
  @Doc({
    summary: '"Why this?" — explanation of a decision made for the current visitor',
    tags: ['storefront'],
    response: explanationSchema,
  })
  async explanation(@ZParam('id', uuid) id: string) {
    const record = await this.decisions.explanation(id, { profileId: currentProfileId() });
    if (!record) throw new NotFoundError('Decision', id);
    return record.explanation;
  }
}
