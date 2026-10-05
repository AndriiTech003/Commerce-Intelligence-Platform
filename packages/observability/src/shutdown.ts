import type { Logger } from 'pino';

export function onShutdown(logger: Logger, handler: () => Promise<void>, timeoutMs = 30000): void {
  let stopping = false;
  const run = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error('shutdown timed out');
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    handler()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => run('SIGTERM'));
  process.on('SIGINT', () => run('SIGINT'));
}
