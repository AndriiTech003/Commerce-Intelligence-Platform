import { Controller, Get, Inject } from '@nestjs/common';
import { experimentSchema, uuid } from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin } from '../../../shared/http/surface';
import { ZParam, ZQuery } from '../../../shared/http/zod';
import { ExperimentService } from '../application/experiment.service';

const experimentQuery = z.object({ hours: z.coerce.number().int().min(1).max(720).optional() });

@Controller('v1/admin')
export class ExperimentsController {
  constructor(@Inject(ExperimentService) private readonly experiments: ExperimentService) {}

  @Get('campaigns/:id/experiment')
  @Admin('marketing:write')
  @Doc({
    summary:
      'Experiment: arms per segment (α, β, impressions, CTR with Wilson 95% interval, P(best)), traffic share over time, holdout, regret',
    tags: ['campaigns'],
    query: experimentQuery,
    response: experimentSchema,
  })
  experiment(
    @ZParam('id', uuid) id: string,
    @ZQuery(experimentQuery) query: z.infer<typeof experimentQuery>,
  ) {
    return this.experiments.experiment(id, query);
  }

  @Get('decisions/:decisionId')
  @Admin('marketing:write')
  @Doc({
    summary: '"Why this ad?" — the stored explanation of a decision',
    tags: ['campaigns'],
    response: z.record(z.string(), z.unknown()),
  })
  decision(@ZParam('decisionId', uuid) id: string) {
    return this.experiments.decision(id);
  }
}
