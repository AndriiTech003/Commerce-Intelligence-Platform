import {
  Global,
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { redisKeys } from '@cip/contracts';
import { AmqpClient, Publisher } from '@cip/messaging';
import type { Logger } from '@cip/observability';
import { Redis } from 'ioredis';
import type { ApiConfig } from '../../config';
import { createEmbeddingProvider } from '@cip/personalization';
import { FEATURE_FLAGS, FeatureFlags } from '../flags/feature-flags';
import { createLlmClient } from '../llm/factory';
import { LLM_CLIENT } from '../llm/llm';
import {
  AMQP,
  CLICKHOUSE,
  CONFIG,
  EMBEDDINGS,
  KEYS,
  LOGGER,
  MAILER,
  PUBLISHER,
  REDIS,
  STORAGE,
} from '../tokens';
import { Mailer } from './mailer';
import { ObjectStorage } from './storage';

@Injectable()
class SharedLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLICKHOUSE) private readonly clickhouse: ClickHouseClient,
    @Inject(AMQP) private readonly amqp: AmqpClient,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(FEATURE_FLAGS) private readonly flags: FeatureFlags,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.flags.close();
    await this.amqp.close();
    await this.clickhouse.close().catch(() => undefined);
    this.redis.disconnect();
    this.mailer.close();
    this.storage.destroy();
  }
}

@Global()
@Module({})
export class SharedModule {
  static forRoot(config: ApiConfig, logger: Logger): DynamicModule {
    return {
      module: SharedModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: LOGGER, useValue: logger },
        { provide: KEYS, useValue: redisKeys(config.REDIS_PREFIX) },
        {
          provide: REDIS,
          useFactory: () =>
            new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, enableAutoPipelining: true }),
        },
        {
          provide: CLICKHOUSE,
          useFactory: () =>
            createClient({
              url: config.CLICKHOUSE_URL,
              database: config.CLICKHOUSE_DATABASE,
              request_timeout: 15000,
            }),
        },
        {
          provide: AMQP,
          useFactory: () => {
            const client = new AmqpClient({ url: config.RABBITMQ_URL, name: 'api', logger });
            void client.start();
            return client;
          },
        },
        { provide: PUBLISHER, useFactory: (client: AmqpClient) => new Publisher(client), inject: [AMQP] },
        { provide: MAILER, useFactory: () => new Mailer(config) },
        { provide: STORAGE, useFactory: () => new ObjectStorage(config) },
        { provide: LLM_CLIENT, useFactory: () => createLlmClient(config) },
        {
          provide: EMBEDDINGS,
          useFactory: () =>
            createEmbeddingProvider({
              provider: config.EMBEDDINGS_PROVIDER,
              model: config.EMBEDDINGS_MODEL,
              url: config.EMBEDDINGS_URL,
              apiKey: config.EMBEDDINGS_API_KEY,
              version: config.EMBEDDINGS_VERSION,
            }),
        },
        {
          provide: FEATURE_FLAGS,
          useFactory: () =>
            new FeatureFlags({
              relayUrl: config.FLAGS_RELAY_URL,
              sdkKey: config.FLAGS_SDK_KEY,
              fallback: config.AI_CREATIVES_DEFAULT,
              logger,
            }),
        },
        SharedLifecycle,
      ],
      exports: [
        CONFIG,
        LOGGER,
        KEYS,
        REDIS,
        CLICKHOUSE,
        AMQP,
        PUBLISHER,
        MAILER,
        STORAGE,
        LLM_CLIENT,
        EMBEDDINGS,
        FEATURE_FLAGS,
      ],
    };
  }
}
