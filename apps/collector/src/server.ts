import { AmqpClient, Publisher } from '@cip/messaging';
import { createLogger, initMetrics, type Logger } from '@cip/observability';
import { redisKeys } from '@cip/contracts';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import { buildCollector } from './app';
import { PublishBuffer } from './buffer';
import type { CollectorConfig } from './config';
import { CachedKeyResolver } from './keys';
import { SlidingWindowRateLimiter } from './rate-limit';

export interface RunningCollector {
  app: FastifyInstance;
  url: string;
  logger: Logger;
  buffer: PublishBuffer;
  amqp: AmqpClient;
  stop(): Promise<void>;
}

export async function startCollector(
  config: CollectorConfig,
  options: { listen?: boolean } = {},
): Promise<RunningCollector> {
  initMetrics('collector');
  const logger = createLogger('collector', { level: config.LOG_LEVEL });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  const pool = new pg.Pool({ connectionString: config.DATABASE_SYSTEM_URL, max: 4 });
  pool.on('error', () => undefined);
  const amqp = new AmqpClient({ url: config.RABBITMQ_URL, name: 'collector', logger });
  const publisher = new Publisher(amqp);
  await amqp.start();
  const buffer = new PublishBuffer(publisher, config.BUFFER_MAX, logger);
  buffer.start();
  const limiter = new SlidingWindowRateLimiter(redis, config.REDIS_PREFIX);
  const burstWindowMs = Math.max(
    1000,
    Math.round((config.RATE_LIMIT_BURST / config.RATE_LIMIT_PER_KEY) * 1000),
  );
  const app = await buildCollector({
    buffer,
    keys: new CachedKeyResolver(redis, redisKeys(config.REDIS_PREFIX), pool, config.KEY_CACHE_MS),
    limit: (subject, cost, kind) =>
      kind === 'key'
        ? limiter.consume(`key:${subject}`, cost, config.RATE_LIMIT_BURST, burstWindowMs)
        : limiter.consume(`ip:${subject}`, cost, config.RATE_LIMIT_PER_IP, 1000),
    ready: () => publisher.ready,
    logger,
    maxEvents: config.MAX_EVENTS_PER_BATCH,
    maxBodyBytes: config.MAX_BODY_BYTES,
  });
  let url = '';
  if (options.listen !== false) {
    url = await app.listen({ port: config.COLLECTOR_PORT, host: config.COLLECTOR_HOST });
  } else {
    await app.ready();
  }
  return {
    app,
    url,
    logger,
    buffer,
    amqp,
    stop: async () => {
      await app.close();
      buffer.stop();
      await buffer.drain().catch(() => 0);
      await amqp.close();
      redis.disconnect();
      await pool.end();
    },
  };
}
