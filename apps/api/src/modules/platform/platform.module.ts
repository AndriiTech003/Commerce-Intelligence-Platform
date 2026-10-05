import { Module } from '@nestjs/common';
import { PlatformService } from './application/platform.service';
import { DLQ_ADMIN } from './application/ports';
import { PlatformController } from './http/platform.controller';
import { RabbitDlqAdapter } from './infrastructure/dlq.adapter';

@Module({
  controllers: [PlatformController],
  providers: [{ provide: DLQ_ADMIN, useClass: RabbitDlqAdapter }, PlatformService],
})
export class PlatformModule {}
