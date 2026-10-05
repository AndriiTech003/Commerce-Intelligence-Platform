import { createLogger, initMetrics } from '@cip/observability';
import { loadConfig } from './config';
import { loadEmbedder, type Embedder } from './model';
import { createEmbeddingsServer, listen, stopServer } from './server';

const config = loadConfig();
initMetrics('embeddings-server');
const logger = createLogger('embeddings-server', { level: config.LOG_LEVEL });
let embedder: Embedder | undefined;

const server = createEmbeddingsServer({
  model: config.EMBEDDINGS_MODEL,
  maxInputs: config.EMBEDDINGS_MAX_INPUTS,
  maxChars: config.EMBEDDINGS_MAX_CHARS,
  isReady: () => embedder !== undefined,
  dimensions: () => embedder?.dimensions,
  embed: (texts) => {
    if (!embedder) return Promise.reject(new Error('model not loaded'));
    return embedder.embed(texts);
  },
  logger,
});

const url = await listen(server, config.EMBEDDINGS_SERVER_PORT, config.EMBEDDINGS_SERVER_HOST);
logger.info(
  { url, model: config.EMBEDDINGS_MODEL, cacheDir: config.EMBEDDINGS_CACHE_DIR },
  'embeddings server listening',
);

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  const timer = setTimeout(() => {
    logger.error('shutdown timed out');
    process.exit(1);
  }, 30000);
  timer.unref();
  stopServer(server)
    .then(() => embedder?.dispose())
    .then(() => {
      logger.info('shutdown complete');
      process.exitCode = 0;
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGINT');
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const started = performance.now();
try {
  embedder = await loadEmbedder({
    model: config.EMBEDDINGS_MODEL,
    cacheDir: config.EMBEDDINGS_CACHE_DIR,
    threads: config.EMBEDDINGS_THREADS,
    batchSize: config.EMBEDDINGS_BATCH_SIZE,
    dtype: config.EMBEDDINGS_DTYPE,
  });
  logger.info(
    {
      model: embedder.model,
      dimensions: embedder.dimensions,
      loadMs: Math.round(performance.now() - started),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    },
    'embedding model ready',
  );
} catch (error) {
  logger.fatal({ err: error }, 'failed to load embedding model');
  await stopServer(server, 1000);
  process.exitCode = 1;
}
if (stopping && embedder) await embedder.dispose();
