import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { randomBytes } from 'node:crypto';
import { NotFoundError } from '../../../shared/errors';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  WEBHOOK_REPOSITORY,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookRepository,
} from './ports';

@Injectable()
export class WebhookService {
  constructor(
    @Inject(WEBHOOK_REPOSITORY) private readonly repo: WebhookRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  view(e: WebhookEndpoint) {
    return {
      id: e.id,
      url: e.url,
      events: e.events as Array<'order.paid' | 'order.refunded'>,
      status: e.status,
      secretPrefix: e.secretPrefix,
      description: e.description,
      createdAt: e.createdAt.toISOString(),
      disabledAt: e.disabledAt?.toISOString() ?? null,
      lastDeliveryAt: e.lastDeliveryAt?.toISOString() ?? null,
    };
  }

  deliveryView(d: WebhookDelivery) {
    return {
      ...d,
      nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
    };
  }

  async list() {
    return { data: (await this.uow.run(() => this.repo.list())).map((e) => this.view(e)) };
  }

  async create(input: { url: string; events: string[]; description?: string | undefined }) {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const created = await this.uow.run(() =>
      this.repo.insert({
        id: uuidv7(),
        url: input.url,
        events: [...new Set(input.events)],
        secret,
        secretPrefix: secret.slice(0, 12),
        status: 'active',
        description: input.description ?? null,
      }),
    );
    return { ...this.view(created), secret };
  }

  async update(
    id: string,
    patch: {
      url?: string | undefined;
      events?: string[] | undefined;
      status?: 'active' | 'disabled' | undefined;
      description?: string | null | undefined;
    },
  ) {
    return this.uow.run(async () => {
      const before = await this.repo.find(id);
      if (!before) throw new NotFoundError('Webhook endpoint', id);
      const after = (await this.repo.update(id, {
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.events !== undefined ? { events: [...new Set(patch.events)] } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        ...(patch.status !== undefined
          ? { status: patch.status, disabledAt: patch.status === 'disabled' ? new Date() : null }
          : {}),
      }))!;
      return { before: this.view(before), after: this.view(after) };
    });
  }

  async remove(id: string) {
    return this.uow.run(async () => {
      const before = await this.repo.find(id);
      if (!before || !(await this.repo.remove(id))) throw new NotFoundError('Webhook endpoint', id);
      return this.view(before);
    });
  }

  async deliveries(endpointId: string, limit: number) {
    return this.uow.run(async () => {
      if (!(await this.repo.find(endpointId))) throw new NotFoundError('Webhook endpoint', endpointId);
      return { data: (await this.repo.deliveries(endpointId, limit)).map((d) => this.deliveryView(d)) };
    });
  }

  async resend(deliveryId: string) {
    return this.uow.run(async () => {
      const delivery = await this.repo.findDelivery(deliveryId);
      if (!delivery) throw new NotFoundError('Webhook delivery', deliveryId);
      const endpoint = await this.repo.find(delivery.endpointId);
      if (endpoint?.status !== 'active')
        await this.repo.update(delivery.endpointId, { status: 'active', disabledAt: null });
      return this.deliveryView((await this.repo.resend(deliveryId))!);
    });
  }
}
