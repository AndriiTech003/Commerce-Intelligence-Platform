import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  dlqMessageSchema,
  dlqQueueSchema,
  dlqReplayResultSchema,
  dlqReplaySchema,
  tenantAdminSchema,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Platform } from '../../../shared/http/surface';
import { ZBody, ZQuery } from '../../../shared/http/zod';
import { PlatformService } from '../application/platform.service';

const peekQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

@Controller('v1/platform')
export class PlatformController {
  constructor(@Inject(PlatformService) private readonly platform: PlatformService) {}

  @Get('tenants')
  @Platform()
  @Doc({
    summary: 'All tenants with counts (platform admin)',
    tags: ['platform'],
    response: z.object({ data: z.array(tenantAdminSchema) }),
  })
  tenants() {
    return this.platform.tenantList();
  }

  @Get('dlq')
  @Platform()
  @Doc({
    summary: 'Dead-letter queues and message counts',
    tags: ['platform'],
    response: z.object({ data: z.array(dlqQueueSchema) }),
  })
  dlq() {
    return this.platform.dlqList();
  }

  @Get('dlq/:queue/messages')
  @Platform()
  @Doc({
    summary: 'Peek messages of a DLQ (messages stay in the queue)',
    tags: ['platform'],
    query: peekQuery,
    response: z.object({ data: z.array(dlqMessageSchema) }),
  })
  peek(@Param('queue') queue: string, @ZQuery(peekQuery) query: z.infer<typeof peekQuery>) {
    return this.platform.dlqPeek(queue, query.limit);
  }

  @Post('dlq/:queue/replay')
  @Platform()
  @HttpCode(200)
  @Doc({
    summary: 'Move selected or all messages back to the source queue',
    tags: ['platform'],
    body: dlqReplaySchema,
    response: dlqReplayResultSchema,
  })
  replay(@Param('queue') queue: string, @ZBody(dlqReplaySchema) body: z.infer<typeof dlqReplaySchema>) {
    return this.platform.dlqReplay(queue, body.messageIds);
  }
}
