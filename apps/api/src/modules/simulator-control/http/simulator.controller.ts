import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { groundTruthSchema, simulatorCommandSchema, simulatorStateSchema } from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Platform } from '../../../shared/http/surface';
import { ZBody } from '../../../shared/http/zod';
import { SimulatorControlService } from '../application/simulator-control.service';

@Controller('v1/platform/simulator')
export class SimulatorController {
  constructor(@Inject(SimulatorControlService) private readonly simulator: SimulatorControlService) {}

  @Get()
  @Platform()
  @Doc({ summary: 'Simulator state', tags: ['platform'], response: simulatorStateSchema })
  state() {
    return this.simulator.state();
  }

  @Post()
  @Platform()
  @HttpCode(200)
  @Doc({
    summary:
      'Start/stop the traffic simulator, set sessions/sec and persona mix, or shift hidden tone preferences',
    tags: ['platform'],
    body: simulatorCommandSchema,
    response: simulatorStateSchema,
  })
  command(@ZBody(simulatorCommandSchema) body: z.infer<typeof simulatorCommandSchema>) {
    return this.simulator.apply(body);
  }

  @Get('ground-truth')
  @Platform()
  @Doc({
    summary: 'Ground truth vs learned: hidden best tone per persona against the tone the bandit converged to',
    tags: ['platform'],
    response: groundTruthSchema,
  })
  groundTruth() {
    return this.simulator.groundTruth();
  }
}
