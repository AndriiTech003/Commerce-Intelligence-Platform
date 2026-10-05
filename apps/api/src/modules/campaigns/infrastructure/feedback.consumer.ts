import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Consumer, type AmqpClient, type Publisher } from '@cip/messaging';
import type { Logger } from '@cip/observability';
import type { ApiConfig } from '../../../config';
import { AMQP, CONFIG, LOGGER, PUBLISHER } from '../../../shared/tokens';
import { FeedbackService, parseFeedback, type FeedbackEvent } from '../application/feedback.service';

@Injectable()
export class BanditFeedbackConsumer implements OnModuleInit, OnApplicationShutdown {
  private consumer: Consumer<FeedbackEvent> | null = null;

  constructor(
    @Inject(AMQP) private readonly amqp: AmqpClient,
    @Inject(PUBLISHER) private readonly publisher: Publisher,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(FeedbackService) private readonly feedback: FeedbackService,
  ) {}

  onModuleInit(): void {
    if (!this.config.CONSUMERS_ENABLED) return;
    this.consumer = new Consumer(
      this.amqp,
      this.publisher,
      {
        queue: 'bandit.feedback',
        consumer: 'bandit',
        prefetch: 200,
        parse: parseFeedback,
        handler: (message) => this.feedback.handle(message),
        occurredAt: (m) => m.event.occurred_at,
      },
      this.logger,
    );
    this.consumer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.stop();
  }
}
