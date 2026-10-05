import { Global, Module } from '@nestjs/common';
import { OUTBOX_WRITER } from './application/ports';
import { DrizzleOutboxWriter } from './infrastructure/drizzle-outbox.writer';

@Global()
@Module({
  providers: [{ provide: OUTBOX_WRITER, useClass: DrizzleOutboxWriter }],
  exports: [OUTBOX_WRITER],
})
export class OutboxModule {}
