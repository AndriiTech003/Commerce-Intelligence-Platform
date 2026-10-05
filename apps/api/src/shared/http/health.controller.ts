import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import type { AmqpClient } from '@cip/messaging';
import { metricsText, runHealthChecks } from '@cip/observability';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { TenantDatabase } from '../../modules/tenancy';
import { AMQP, CLICKHOUSE, REDIS } from '../tokens';
import { Doc } from './doc';
import { Public } from './surface';

const healthSchema = z.object({ status: z.string(), checks: z.record(z.string(), z.string()).optional() });

@Controller()
export class HealthController {
  constructor(
    @Inject(TenantDatabase) private readonly db: TenantDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLICKHOUSE) private readonly clickhouse: ClickHouseClient,
    @Inject(AMQP) private readonly amqp: AmqpClient,
  ) {}

  @Get('health/live')
  @Public()
  @Doc({ summary: 'Liveness', tags: ['ops'], response: healthSchema })
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @Public()
  @Doc({
    summary: 'Readiness: PostgreSQL and Redis (ClickHouse and RabbitMQ reported, not required)',
    tags: ['ops'],
    response: healthSchema,
  })
  async ready(@Res({ passthrough: true }) res: Response) {
    const required = await runHealthChecks({
      postgres: () => this.db.ping(),
      redis: async () => {
        await this.redis.ping();
      },
    });
    const optional = await runHealthChecks({
      clickhouse: async () => {
        const result = await this.clickhouse.ping();
        if (!result.success) throw new Error('unreachable');
      },
      rabbitmq: () => {
        if (!this.amqp.connected) throw new Error('disconnected');
      },
    });
    if (!required.ok) res.status(503);
    return { status: required.ok ? 'ok' : 'unavailable', checks: { ...required.checks, ...optional.checks } };
  }

  @Get('metrics')
  @Public()
  @Doc({ summary: 'Prometheus metrics', tags: ['ops'] })
  async metrics(@Res() res: Response) {
    const { contentType, body } = await metricsText();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }
}
