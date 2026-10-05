import { Global, Module } from '@nestjs/common';
import { JobService } from './application/job.service';
import { JOB_REPOSITORY } from './application/ports';
import { JobsController } from './http/jobs.controller';
import { DrizzleJobRepository } from './infrastructure/job.repository';

@Global()
@Module({
  controllers: [JobsController],
  providers: [{ provide: JOB_REPOSITORY, useClass: DrizzleJobRepository }, JobService],
  exports: [JobService],
})
export class JobsModule {}
