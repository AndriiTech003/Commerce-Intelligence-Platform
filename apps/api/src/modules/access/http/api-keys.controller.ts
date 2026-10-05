import { Controller, Delete, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { apiKeyCreatedSchema, apiKeyCreateSchema, apiKeySchema, uuid } from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { ApiKeyService } from '../application/api-key.service';

@Controller('v1/admin/api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeyService) private readonly keys: ApiKeyService) {}

  @Get()
  @Admin('apikeys:manage')
  @Doc({
    summary: 'API keys (prefix only; secrets are never stored)',
    tags: ['api-keys'],
    response: z.object({ data: z.array(apiKeySchema) }),
  })
  async list() {
    return { data: (await this.keys.list()).map((r) => this.keys.view(r)) };
  }

  @Post()
  @Admin('apikeys:manage')
  @Audit('api_key.created', 'api_key')
  @Doc({
    summary: 'Create a key; the secret is returned only once',
    tags: ['api-keys'],
    body: apiKeyCreateSchema,
    response: apiKeyCreatedSchema,
    status: 201,
  })
  async create(@ZBody(apiKeyCreateSchema) body: z.infer<typeof apiKeyCreateSchema>) {
    const { record, secret } = await this.keys.create(body.kind, body.scopes, this.keys.currentActorId());
    currentContext()?.audit.push({
      entityId: record.id,
      before: null,
      after: { kind: record.kind, prefix: record.prefix, scopes: record.scopes },
    });
    return { ...this.keys.view(record), secret };
  }

  @Delete(':id')
  @Admin('apikeys:manage')
  @Audit('api_key.revoked', 'api_key')
  @HttpCode(204)
  @Doc({ summary: 'Revoke a key', tags: ['api-keys'], status: 204 })
  async revoke(@ZParam('id', uuid) id: string) {
    await this.keys.revoke(id);
    currentContext()?.audit.push({ entityId: id });
  }
}
