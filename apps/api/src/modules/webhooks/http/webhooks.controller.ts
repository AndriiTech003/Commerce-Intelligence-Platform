import { Controller, Delete, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import {
  uuid,
  webhookCreateSchema,
  webhookDeliverySchema,
  webhookEndpointCreatedSchema,
  webhookEndpointSchema,
  webhookUpdateSchema,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam, ZQuery } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { WebhookService } from '../application/webhook.service';

const deliveriesQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

@Controller('v1/admin/webhooks')
export class WebhooksController {
  constructor(@Inject(WebhookService) private readonly webhooks: WebhookService) {}

  @Get()
  @Admin('settings:write')
  @Doc({
    summary: 'Outgoing webhook endpoints',
    tags: ['webhooks'],
    response: z.object({ data: z.array(webhookEndpointSchema) }),
  })
  list() {
    return this.webhooks.list();
  }

  @Post()
  @Admin('settings:write')
  @Audit('webhook.created', 'webhook_endpoint')
  @Doc({
    summary: 'Register an endpoint; the signing secret is shown once',
    tags: ['webhooks'],
    body: webhookCreateSchema,
    response: webhookEndpointCreatedSchema,
    status: 201,
  })
  async create(@ZBody(webhookCreateSchema) body: z.infer<typeof webhookCreateSchema>) {
    const created = await this.webhooks.create(body);
    const { secret: _secret, ...safe } = created;
    currentContext()?.audit.push({ entityId: created.id, before: null, after: safe });
    return created;
  }

  @Patch(':id')
  @Admin('settings:write')
  @Audit('webhook.updated', 'webhook_endpoint')
  @Doc({
    summary: 'Update or re-enable an endpoint',
    tags: ['webhooks'],
    body: webhookUpdateSchema,
    response: webhookEndpointSchema,
  })
  async update(
    @ZParam('id', uuid) id: string,
    @ZBody(webhookUpdateSchema) body: z.infer<typeof webhookUpdateSchema>,
  ) {
    const { before, after } = await this.webhooks.update(id, body);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: { ...after } });
    return after;
  }

  @Delete(':id')
  @Admin('settings:write')
  @Audit('webhook.deleted', 'webhook_endpoint')
  @HttpCode(204)
  @Doc({ summary: 'Delete an endpoint and its delivery log', tags: ['webhooks'], status: 204 })
  async remove(@ZParam('id', uuid) id: string) {
    const before = await this.webhooks.remove(id);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: null });
  }

  @Get(':id/deliveries')
  @Admin('settings:write')
  @Doc({
    summary: 'Delivery log (status, attempts, response codes)',
    tags: ['webhooks'],
    query: deliveriesQuery,
    response: z.object({ data: z.array(webhookDeliverySchema) }),
  })
  deliveries(
    @ZParam('id', uuid) id: string,
    @ZQuery(deliveriesQuery) query: z.infer<typeof deliveriesQuery>,
  ) {
    return this.webhooks.deliveries(id, query.limit);
  }

  @Post('deliveries/:deliveryId/resend')
  @Admin('settings:write')
  @Audit('webhook.resent', 'webhook_delivery')
  @HttpCode(202)
  @Doc({
    summary: 'Resend a delivery (re-enables a disabled endpoint)',
    tags: ['webhooks'],
    response: webhookDeliverySchema,
    status: 202,
  })
  resend(@ZParam('deliveryId', uuid) id: string) {
    return this.webhooks.resend(id);
  }
}
