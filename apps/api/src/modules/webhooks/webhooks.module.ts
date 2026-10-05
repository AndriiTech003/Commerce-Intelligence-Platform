import { Module } from '@nestjs/common';
import { WEBHOOK_REPOSITORY } from './application/ports';
import { WebhookService } from './application/webhook.service';
import { WebhooksController } from './http/webhooks.controller';
import { DrizzleWebhookRepository } from './infrastructure/webhook.repository';

@Module({
  controllers: [WebhooksController],
  providers: [{ provide: WEBHOOK_REPOSITORY, useClass: DrizzleWebhookRepository }, WebhookService],
  exports: [WebhookService],
})
export class WebhooksModule {}
