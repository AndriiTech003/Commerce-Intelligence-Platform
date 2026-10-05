import pg from 'pg';
import { createLogger } from '@cip/observability';
import { loadConfig } from './config';
import { ProductEmbedder } from './embeddings';
import { embeddingProviderFrom } from './worker';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const version = flag('version');
const config = loadConfig({ ...process.env, ...(version ? { EMBEDDINGS_VERSION: version } : {}) });
const logger = createLogger('reembed', { level: config.LOG_LEVEL });
const pool = new pg.Pool({ connectionString: config.DATABASE_SYSTEM_URL, max: 2 });
const embedder = new ProductEmbedder(pool, embeddingProviderFrom(config), logger);
const started = Date.now();
let last = 0;
const result = await embedder.reembed({
  all: args.includes('--all'),
  ...(flag('tenant') ? { tenantId: flag('tenant')! } : {}),
  onProgress: (done, total) => {
    if (done === total || Date.now() - last > 2000) {
      last = Date.now();
      console.log(`reembed: ${done}/${total}`);
    }
  },
});
console.log(
  `reembed: ${result.embedded} of ${result.total} products embedded with ${embedder.version} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
await pool.end();
