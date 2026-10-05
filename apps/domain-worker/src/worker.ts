import { RedisDeduper, AmqpClient, BatchConsumer, Consumer, OutboxRelay, Publisher } from '@cip/messaging';
import { createEmbeddingProvider, type EmbeddingProvider } from '@cip/personalization';
import { createLogger, initMetrics, startOpsServer, type Logger } from '@cip/observability';
import { redisKeys } from '@cip/contracts';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import pg from 'pg';
import type { Server } from 'node:http';
import type { WorkerConfig } from './config';
import { EMBEDDING_BATCH, parseProductUpserted, ProductEmbedder } from './embeddings';
import { expireReservations } from './jobs/reservation-expiry';
import { DistributedLock } from './lock';
import { NotificationHandler, parseNotification, type MailTransport } from './notifications/handler';
import { parseWebhookEvent, WebhookDispatcher } from './webhooks';

export function embeddingProviderFrom(config: WorkerConfig): EmbeddingProvider {
  return createEmbeddingProvider({
    provider: config.EMBEDDINGS_PROVIDER,
    model: config.EMBEDDINGS_MODEL,
    url: config.EMBEDDINGS_URL,
    apiKey: config.EMBEDDINGS_API_KEY,
    version: config.EMBEDDINGS_VERSION,
  });
}

export interface DomainWorker {
  relay: OutboxRelay | null;
  pool: pg.Pool;
  redis: Redis;
  amqp: AmqpClient;
  logger: Logger;
  embedder: ProductEmbedder;
  webhooks: WebhookDispatcher;
  expireOnce(): Promise<number>;
  stop(): Promise<void>;
}

export async function startDomainWorker(
  config: WorkerConfig,
  options: {
    opsServer?: boolean;
    mail?: MailTransport;
    logger?: Logger;
    embeddings?: EmbeddingProvider;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<DomainWorker> {
  initMetrics('domain-worker');
  const logger = options.logger ?? createLogger('domain-worker', { level: config.LOG_LEVEL });
  const pool = new pg.Pool({ connectionString: config.DATABASE_SYSTEM_URL, max: 10 });
  pool.on('error', (error) => logger.warn({ err: error }, 'pg pool error'));
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  const keys = redisKeys(config.REDIS_PREFIX);
  const amqp = new AmqpClient({ url: config.RABBITMQ_URL, name: 'domain-worker', logger });
  const publisher = new Publisher(amqp);
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
  });
  const mail: MailTransport = options.mail ?? {
    send: async (message) => {
      await transport.sendMail({ from: config.MAIL_FROM, ...message });
    },
  };
  const notifications = new NotificationHandler(pool, mail, config.STOREFRONT_URL_TEMPLATE, logger);
  const notificationConsumer = new Consumer(
    amqp,
    publisher,
    {
      queue: 'notifications',
      consumer: 'notifications',
      prefetch: 20,
      parse: parseNotification,
      handler: (event, ctx) => notifications.handle(event, ctx.messageId),
    },
    logger,
  );
  const embedder = new ProductEmbedder(pool, options.embeddings ?? embeddingProviderFrom(config), logger);
  const embeddingsConsumer = new BatchConsumer(
    amqp,
    publisher,
    {
      queue: 'catalog.embeddings',
      consumer: 'embeddings',
      prefetch: EMBEDDING_BATCH * 2,
      batchSize: EMBEDDING_BATCH,
      flushIntervalMs: config.EMBEDDINGS_FLUSH_MS,
      parse: parseProductUpserted,
      handleBatch: (items) => embedder.handleBatch(items),
    },
    logger,
  );
  const webhooks = new WebhookDispatcher(pool, mail, logger, {
    scheduleSeconds: config.WEBHOOK_RETRY_SCHEDULE,
    timeoutMs: config.WEBHOOK_TIMEOUT_MS,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const webhookConsumer = new Consumer(
    amqp,
    publisher,
    {
      queue: 'webhooks.outgoing',
      consumer: 'webhooks',
      prefetch: 20,
      parse: parseWebhookEvent,
      handler: async (event) => {
        await webhooks.enqueue(event);
      },
      idempotency: { deduper: new RedisDeduper(redis, { prefix: config.REDIS_PREFIX }) },
    },
    logger,
  );
  notificationConsumer.start();
  embeddingsConsumer.start();
  webhookConsumer.start();
  await amqp.start();
  const relay = config.RELAY_ENABLED
    ? new OutboxRelay({ pool, publisher, logger, batchSize: config.RELAY_BATCH_SIZE })
    : null;
  await relay?.start();
  const expiryLock = new DistributedLock(redis, keys.lock('reservation-expiry'));
  const cleanupLock = new DistributedLock(redis, keys.lock('outbox-cleanup'));
  const expireOnce = async () => {
    const { result } = await expiryLock.withLock(
      Math.max(5000, config.RESERVATION_EXPIRY_INTERVAL_MS - 1000),
      () => expireReservations(pool, logger),
    );
    return result ?? 0;
  };
  const expiryTimer = setInterval(
    () => void expireOnce().catch((error: unknown) => logger.error({ err: error }, 'expiry failed')),
    config.RESERVATION_EXPIRY_INTERVAL_MS,
  );
  const webhookLock = new DistributedLock(redis, keys.lock('webhook-retries'));
  const webhookTimer = setInterval(() => {
    void webhookLock
      .withLock(Math.max(5000, config.WEBHOOK_POLL_INTERVAL_MS * 4), () => webhooks.deliverDue())
      .catch((error: unknown) => logger.warn({ err: error }, 'webhook retries failed'));
  }, config.WEBHOOK_POLL_INTERVAL_MS);
  const cleanupTimer = setInterval(() => {
    void cleanupLock
      .withLock(60_000, async () => (relay ? relay.cleanup(config.OUTBOX_RETENTION_DAYS) : 0))
      .catch((error: unknown) => logger.error({ err: error }, 'outbox cleanup failed'));
  }, 3600_000);
  let server: Server | null = null;
  if (options.opsServer !== false) {
    server = await startOpsServer({
      port: config.DOMAIN_WORKER_PORT,
      ready: {
        postgres: async () => {
          await pool.query('select 1');
        },
        redis: async () => {
          await redis.ping();
        },
        rabbitmq: () => {
          if (!amqp.connected) throw new Error('disconnected');
        },
      },
    });
  }
  logger.info({ port: config.DOMAIN_WORKER_PORT }, 'domain-worker started');
  return {
    relay,
    pool,
    redis,
    amqp,
    logger,
    embedder,
    webhooks,
    expireOnce,
    stop: async () => {
      clearInterval(expiryTimer);
      clearInterval(cleanupTimer);
      clearInterval(webhookTimer);
      await notificationConsumer.stop();
      await embeddingsConsumer.stop();
      await webhookConsumer.stop();
      await relay?.stop();
      await amqp.close();
      transport.close();
      redis.disconnect();
      await pool.end();
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
  };
}
