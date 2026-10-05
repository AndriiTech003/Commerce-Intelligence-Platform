import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger, initMetrics, type Logger } from '@cip/observability';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import type { ApiConfig } from './config';
import { runMigrations } from './db/migrate';
import { requestMiddleware } from './shared/http/request.middleware';
import { currentContext } from './shared/request-context';

export interface RunningApi {
  app: NestExpressApplication;
  url: string;
  logger: Logger;
  close(): Promise<void>;
}

export async function createApp(config: ApiConfig, options: { listen?: boolean } = {}): Promise<RunningApi> {
  initMetrics('api');
  const logger = createLogger('api', {
    level: config.LOG_LEVEL,
    context: () => {
      const ctx = currentContext();
      return ctx
        ? {
            requestId: ctx.requestId,
            tenantId: ctx.tenantId ?? undefined,
            userId: ctx.actor?.id ?? undefined,
          }
        : undefined;
    },
  });
  if (config.MIGRATE_ON_START) await runMigrations(config.DATABASE_ADMIN_URL);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, logger), {
    logger: ['error', 'warn'],
    bodyParser: false,
  });
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.useBodyParser('json', {
    limit: '1mb',
    verify: (req: unknown, _res: unknown, buf: Buffer) => {
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  });
  app.useBodyParser('text', { type: ['text/csv', 'text/plain'], limit: '5mb' });
  app.use(requestMiddleware);
  app.enableCors({
    origin: true,
    credentials: true,
    exposedHeaders: [
      'ETag',
      'X-Request-Id',
      'traceparent',
      'Idempotent-Replayed',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
    ],
  });
  app.enableShutdownHooks();
  let url = '';
  if (options.listen !== false) {
    await app.listen(config.API_PORT, config.API_HOST);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : config.API_PORT;
    url = `http://${config.API_HOST}:${port}`;
  } else {
    await app.init();
  }
  return {
    app,
    url,
    logger,
    close: async () => {
      await app.close();
    },
  };
}
