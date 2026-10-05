import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { loadEmbedder, type Embedder } from '../../src/model';

const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

describe('local MiniLM embedder', () => {
  let embedder: Embedder;

  beforeAll(async () => {
    const config = loadConfig();
    embedder = await loadEmbedder({
      model: config.EMBEDDINGS_MODEL,
      cacheDir: config.EMBEDDINGS_CACHE_DIR,
      threads: config.EMBEDDINGS_THREADS,
      batchSize: config.EMBEDDINGS_BATCH_SIZE,
      dtype: config.EMBEDDINGS_DTYPE,
    });
  });

  afterAll(async () => {
    await embedder?.dispose();
  });

  it('produces normalized 384-dim vectors with sensible similarity', async () => {
    const { vectors, tokens } = await embedder.embed([
      'Lightweight running shoes with breathable mesh',
      'Cushioned road running sneakers for marathon training',
      'Dark roast whole bean coffee, 1 kg bag',
    ]);
    expect(embedder.dimensions).toBe(384);
    expect(tokens).toBeGreaterThan(0);
    for (const v of vectors) expect(Math.abs(cosine(v, v) - 1)).toBeLessThan(1e-3);
    const [shoeA, shoeB, coffee] = vectors as [number[], number[], number[]];
    expect(cosine(shoeA, shoeB)).toBeGreaterThan(cosine(shoeA, coffee));
  });
});
