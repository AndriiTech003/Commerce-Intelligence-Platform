import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { redisKeys } from '@cip/contracts';
import { AmqpClient, BatchConsumer, Consumer, Publisher, RedisDeduper } from '@cip/messaging';
import { createLogger, initMetrics, startOpsServer, type Logger } from '@cip/observability';
import { Redis } from 'ioredis';
import type { Server } from 'node:http';
import { AnalyticsSink } from './analytics-sink';
import type { StreamConfig } from './config';
import { CooccurrenceUpdater } from './cooccurrence';
import { DecisionSink, parseDecision } from './decisions-sink';
import { parsePipelineEvent, type PipelineEvent } from './mapping';
import { ProfileUpdater } from './profiles';
import { RealtimeAggregator } from './realtime';
import { RecoRefresher } from './reco-refresh';

export interface StreamWorker {
  logger: Logger;
  clickhouse: ClickHouseClient;
  redis: Redis;
  amqp: AmqpClient;
  realtime: RealtimeAggregator;
  profiles: ProfileUpdater;
  reco: RecoRefresher;
  stop(): Promise<void>;
}

export async function startStreamWorker(
  config: StreamConfig,
  options: { opsServer?: boolean } = {},
): Promise<StreamWorker> {
  initMetrics('stream-worker');
  const logger = createLogger('stream-worker', { level: config.LOG_LEVEL });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  const keys = redisKeys(config.REDIS_PREFIX);
  const clickhouse = createClient({
    url: config.CLICKHOUSE_URL,
    database: config.CLICKHOUSE_DATABASE,
    request_timeout: 30000,
  });
  const amqp = new AmqpClient({ url: config.RABBITMQ_URL, name: 'stream-worker', logger });
  const publisher = new Publisher(amqp);
  const deduper = new RedisDeduper(redis, { prefix: config.REDIS_PREFIX });
  const sink = new AnalyticsSink(clickhouse, deduper, {
    verifyWithClickHouse: config.CLICKHOUSE_DEDUP_CHECK,
  });
  const profileUpdater = new ProfileUpdater(redis, keys);
  const cooc = new CooccurrenceUpdater(redis, keys);
  const decisionSink = new DecisionSink(clickhouse, deduper);
  const reco = new RecoRefresher(clickhouse, redis, keys, logger);
  const realtime = new RealtimeAggregator(redis, keys, config.FEED_SAMPLE_PER_SEC);
  const occurredAt = (item: PipelineEvent) => item.event.occurred_at;

  const analytics = new BatchConsumer<PipelineEvent>(
    amqp,
    publisher,
    {
      queue: 'analytics.ingest',
      consumer: 'evt',
      prefetch: Math.max(config.BATCH_SIZE, 1000),
      batchSize: config.BATCH_SIZE,
      flushIntervalMs: config.FLUSH_INTERVAL_MS,
      parse: parsePipelineEvent,
      handleBatch: async (items) => {
        await sink.handleBatch(items);
      },
      occurredAt,
    },
    logger,
  );
  const counters = new Consumer<PipelineEvent>(
    amqp,
    publisher,
    {
      queue: 'realtime.counters',
      consumer: 'rt',
      prefetch: 200,
      parse: parsePipelineEvent,
      handler: async (item) => {
        if (config.CHAOS_DELAY_MS > 0) await new Promise((r) => setTimeout(r, config.CHAOS_DELAY_MS));
        await realtime.apply(item);
      },
      idempotency: { deduper, mode: 'claim' },
      occurredAt,
    },
    logger,
  );
  const profiles = new BatchConsumer<PipelineEvent>(
    amqp,
    publisher,
    {
      queue: 'profile.update',
      consumer: 'profile',
      prefetch: Math.max(config.PROFILE_BATCH_SIZE, 200),
      batchSize: config.PROFILE_BATCH_SIZE,
      flushIntervalMs: config.PROFILE_FLUSH_MS,
      parse: parsePipelineEvent,
      handleBatch: (items) => profileUpdater.handleBatch(items),
      occurredAt,
    },
    logger,
  );
  const cooccurrence = new Consumer<PipelineEvent>(
    amqp,
    publisher,
    {
      queue: 'reco.cooccurrence',
      consumer: 'cooc',
      prefetch: 200,
      parse: parsePipelineEvent,
      handler: (item) => cooc.apply(item),
      idempotency: { deduper, mode: 'claim' },
      occurredAt,
    },
    logger,
  );
  const decisions = new BatchConsumer(
    amqp,
    publisher,
    {
      queue: 'decisions.log',
      consumer: 'decisions',
      prefetch: Math.max(config.BATCH_SIZE, 1000),
      batchSize: config.BATCH_SIZE,
      flushIntervalMs: config.FLUSH_INTERVAL_MS,
      parse: parseDecision,
      handleBatch: (items) => decisionSink.handleBatch(items),
      occurredAt: (d) => d.decided_at,
    },
    logger,
  );
  for (const consumer of [analytics, counters, profiles, cooccurrence, decisions]) consumer.start();
  await amqp.start();

  const stopReco = reco.start(config.POPULAR_REFRESH_MS, config.QUANTILE_REFRESH_MS);
  const ticker = setInterval(() => {
    void realtime.tick().catch((error: unknown) => logger.warn({ err: error }, 'tick failed'));
  }, config.TICK_INTERVAL_MS);

  let server: Server | null = null;
  if (options.opsServer !== false) {
    server = await startOpsServer({
      port: config.STREAM_WORKER_PORT,
      ready: {
        redis: async () => {
          await redis.ping();
        },
        clickhouse: async () => {
          const ping = await clickhouse.ping();
          if (!ping.success) throw new Error('unreachable');
        },
        rabbitmq: () => {
          if (!amqp.connected) throw new Error('disconnected');
        },
      },
    });
  }
  logger.info({ port: config.STREAM_WORKER_PORT }, 'stream-worker started');
  return {
    logger,
    clickhouse,
    redis,
    amqp,
    realtime,
    profiles: profileUpdater,
    reco,
    stop: async () => {
      clearInterval(ticker);
      stopReco();
      await Promise.all([
        analytics.stop(),
        counters.stop(),
        profiles.stop(),
        cooccurrence.stop(),
        decisions.stop(),
      ]);
      await amqp.close();
      await clickhouse.close();
      redis.disconnect();
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
  };
}
