import { Controller, Get, Inject } from '@nestjs/common';
import { jobSchema, uuid } from '@cip/contracts';
import { Doc } from '../../../shared/http/doc';
import { Admin } from '../../../shared/http/surface';
import { ZParam } from '../../../shared/http/zod';
import { JobService } from '../application/job.service';

@Controller('v1/admin/jobs')
export class JobsController {
  constructor(@Inject(JobService) private readonly jobs: JobService) {}

  @Get(':id')
  @Admin()
  @Doc({
    summary: 'Background job status: progress and per-row errors (CSV import, creative generation)',
    tags: ['jobs'],
    response: jobSchema,
  })
  get(@ZParam('id', uuid) id: string) {
    return this.jobs.get(id);
  }
}
