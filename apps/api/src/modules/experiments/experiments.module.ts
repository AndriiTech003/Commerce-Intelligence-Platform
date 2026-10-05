import { Module } from '@nestjs/common';
import { ExperimentService } from './application/experiment.service';
import { EXPERIMENT_QUERIES } from './application/ports';
import { ExperimentsController } from './http/experiments.controller';
import { ClickHouseExperimentQueries } from './infrastructure/experiment.queries';

@Module({
  controllers: [ExperimentsController],
  providers: [{ provide: EXPERIMENT_QUERIES, useClass: ClickHouseExperimentQueries }, ExperimentService],
  exports: [ExperimentService],
})
export class ExperimentsModule {}
