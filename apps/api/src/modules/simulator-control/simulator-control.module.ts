import { Module } from '@nestjs/common';
import { SimulatorControlService } from './application/simulator-control.service';
import { SimulatorController } from './http/simulator.controller';

@Module({ controllers: [SimulatorController], providers: [SimulatorControlService] })
export class SimulatorControlModule {}
