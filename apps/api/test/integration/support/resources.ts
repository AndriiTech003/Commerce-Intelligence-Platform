import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { dropClickHouseDatabase, migrateClickHouse } from '../../../../../infra/clickhouse/migrate.mjs';
import { amqpUrlFor, applyTopology, deleteVhost } from '../../../../../infra/rabbitmq/apply.mjs';
import { createDatabase, dropDatabase, runMigrations, withDatabase, withUser } from '../../../src/db/migrate';

export interface TestResources {
  id: string;
  databaseAdminUrl: string;
  databaseUrl: string;
  databaseSystemUrl: string;
  redisUrl: string;
  redisPrefix: string;
  rabbitUrl: string;
  rabbitVhost: string;
  rabbitManagementUrl: string;
  clickhouseUrl: string;
  clickhouseDatabase: string;
  s3Endpoint: string;
  s3KeyPrefix: string;
  mailpitUrl: string;
  smtpPort: number;
}

export async function provisionResources(): Promise<{
  resources: TestResources;
  teardown: () => Promise<void>;
}> {
  const id = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const stops: Array<() => Promise<unknown>> = [];
  let pgAdmin = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://127.0.0.1:5432/postgres';
  let redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1';
  let rabbitBase = process.env.TEST_RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672';
  let rabbitManagementUrl = process.env.TEST_RABBITMQ_MANAGEMENT_URL ?? 'http://127.0.0.1:15672';
  let clickhouseUrl = process.env.TEST_CLICKHOUSE_URL ?? 'http://127.0.0.1:8123';
  const s3Endpoint = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9002';
  const mailpitUrl = process.env.TEST_MAILPIT_URL ?? 'http://127.0.0.1:8025';
  if (process.env.TESTCONTAINERS === '1') {
    const { GenericContainer, Wait } = await import('testcontainers');
    const { RedisContainer } = await import('@testcontainers/redis');
    const { RabbitMQContainer } = await import('@testcontainers/rabbitmq');
    const pg = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_PASSWORD: 'postgres', POSTGRES_HOST_AUTH_METHOD: 'trust' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    const redis = await new RedisContainer('redis:7-alpine').start();
    const rabbit = await new RabbitMQContainer('rabbitmq:4-management').start();
    const clickhouse = await new GenericContainer('clickhouse/clickhouse-server:25.3')
      .withExposedPorts(8123)
      .withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1' })
      .withWaitStrategy(Wait.forHttp('/ping', 8123))
      .start();
    stops.push(
      () => pg.stop(),
      () => redis.stop(),
      () => rabbit.stop(),
      () => clickhouse.stop(),
    );
    pgAdmin = `postgres://postgres@${pg.getHost()}:${pg.getMappedPort(5432)}/postgres`;
    redisUrl = `${redis.getConnectionUrl()}/1`;
    rabbitBase = rabbit.getAmqpUrl();
    rabbitManagementUrl = `http://${rabbit.getHost()}:${rabbit.getMappedPort(15672)}`;
    clickhouseUrl = `http://${clickhouse.getHost()}:${clickhouse.getMappedPort(8123)}`;
  }
  const database = `cip_test_${id}`;
  await createDatabase(pgAdmin, database);
  const databaseAdminUrl = withDatabase(pgAdmin, database);
  await runMigrations(databaseAdminUrl);
  const vhost = `cip_test_${id}`;
  await applyTopology({ managementUrl: rabbitManagementUrl, vhost });
  const clickhouseDatabase = `cip_test_${id}`;
  await migrateClickHouse({ url: clickhouseUrl, database: clickhouseDatabase });
  const redisPrefix = `t${id}:`;
  const { ObjectStorage } = await import('../../../src/shared/infrastructure/storage');
  const { loadConfig } = await import('../../../src/config');
  const storage = new ObjectStorage(loadConfig({ S3_ENDPOINT: s3Endpoint, S3_PUBLIC_URL: s3Endpoint }));
  await storage.ensureBucket();
  storage.destroy();
  const resources: TestResources = {
    id,
    databaseAdminUrl,
    databaseUrl: withUser(databaseAdminUrl, 'app_user'),
    databaseSystemUrl: withUser(databaseAdminUrl, 'app_system'),
    redisUrl,
    redisPrefix,
    rabbitUrl: amqpUrlFor(vhost, rabbitBase),
    rabbitVhost: vhost,
    rabbitManagementUrl,
    clickhouseUrl,
    clickhouseDatabase,
    s3Endpoint,
    s3KeyPrefix: `test-${id}/`,
    mailpitUrl,
    smtpPort: Number(process.env.TEST_SMTP_PORT ?? 1025),
  };
  const teardown = async () => {
    await dropDatabase(pgAdmin, database).catch(() => undefined);
    await deleteVhost({ managementUrl: rabbitManagementUrl, vhost }).catch(() => undefined);
    await dropClickHouseDatabase({ url: clickhouseUrl, database: clickhouseDatabase }).catch(() => undefined);
    const redis = new Redis(redisUrl);
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${redisPrefix}*`, 'COUNT', 1000);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
    redis.disconnect();
    for (const stop of stops) await stop().catch(() => undefined);
  };
  return { resources, teardown };
}
