import { env, pipeline } from '@huggingface/transformers';
import type { EmbedResult } from './server';

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<EmbedResult>;
  dispose(): Promise<void>;
}

export interface EmbedderOptions {
  model: string;
  cacheDir: string;
  threads: number;
  batchSize: number;
  dtype: 'q8' | 'int8' | 'uint8' | 'fp16' | 'fp32';
}

export async function loadEmbedder(options: EmbedderOptions): Promise<Embedder> {
  env.cacheDir = options.cacheDir;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useFSCache = true;
  const extractor = await pipeline('feature-extraction', options.model, {
    device: 'cpu',
    dtype: options.dtype,
    session_options: {
      intraOpNumThreads: options.threads,
      interOpNumThreads: 1,
      executionMode: 'sequential',
    },
  });
  const tokenizer = extractor.tokenizer;
  const maxTokens = Number.isFinite(tokenizer.model_max_length) ? tokenizer.model_max_length : 512;

  async function runBatch(texts: string[]): Promise<number[][]> {
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const data = output.data as Float32Array;
    const width = output.dims[output.dims.length - 1] ?? 0;
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      vectors.push(Array.from(data.subarray(i * width, (i + 1) * width)));
    }
    return vectors;
  }

  async function embedAll(texts: string[]): Promise<EmbedResult> {
    const order = texts.map((_, index) => index).sort((a, b) => texts[b]!.length - texts[a]!.length);
    const vectors = new Array<number[]>(texts.length);
    let tokens = 0;
    for (let start = 0; start < order.length; start += options.batchSize) {
      const indices = order.slice(start, start + options.batchSize);
      const batch = indices.map((i) => texts[i]!);
      const result = await runBatch(batch);
      indices.forEach((originalIndex, position) => {
        vectors[originalIndex] = result[position]!;
      });
      for (const text of batch) tokens += Math.min(tokenizer.encode(text).length, maxTokens);
    }
    return { vectors, tokens };
  }

  let queue: Promise<unknown> = Promise.resolve();
  const embed = (texts: string[]): Promise<EmbedResult> => {
    const next = queue.then(() => embedAll(texts));
    queue = next.catch(() => undefined);
    return next;
  };

  const warmup = await embed(['warmup']);
  const dimensions = warmup.vectors[0]?.length ?? 0;

  return {
    model: options.model,
    dimensions,
    embed,
    dispose: async () => {
      await queue;
      await extractor.dispose();
    },
  };
}
