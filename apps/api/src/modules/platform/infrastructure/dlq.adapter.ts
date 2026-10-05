import { Inject, Injectable } from '@nestjs/common';
import { DlqAdmin, type AmqpClient, type Publisher } from '@cip/messaging';
import { AMQP, PUBLISHER } from '../../../shared/tokens';
import type { DlqPort } from '../application/ports';

@Injectable()
export class RabbitDlqAdapter implements DlqPort {
  private readonly admin: DlqAdmin;

  constructor(@Inject(AMQP) amqp: AmqpClient, @Inject(PUBLISHER) publisher: Publisher) {
    this.admin = new DlqAdmin(() => amqp.current, publisher);
  }

  list() {
    return this.admin.list();
  }

  peek(queue: string, limit: number) {
    return this.admin.peek(queue, limit);
  }

  replay(queue: string, ids: string[] | 'all') {
    return this.admin.replay(queue, ids);
  }
}
