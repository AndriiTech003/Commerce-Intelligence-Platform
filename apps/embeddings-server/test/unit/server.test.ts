import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmbeddingsServer,
  listen,
  parseEmbeddingsRequest,
  shapeResponse,
  stopServer,
  truncateText,
  type EmbedFn,
  type EmbeddingsServerOptions,
} from '../../src/server';

const MODEL = 'Xenova/all-MiniLM-L6-v2';

const fakeEmbed: EmbedFn = async (texts) => ({
  vectors: texts.map((text) => [text.length, 1, 0]),
  tokens: texts.reduce((sum, text) => sum + text.split(' ').length + 2, 0),
});

const servers: Server[] = [];

async function start(overrides: Partial<EmbeddingsServerOptions> = {}) {
  const server = createEmbeddingsServer({
    model: MODEL,
    embed: fakeEmbed,
    dimensions: () => 3,
    maxInputs: 4,
    maxChars: 10,
    maxBodyBytes: 4096,
    ...overrides,
  });
  servers.push(server);
  const url = await listen(server, 0, '127.0.0.1');
  return url;
}

async function post(url: string, body: unknown) {
  const response = await fetch(`${url}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => stopServer(server, 100)));
});

describe('parseEmbeddingsRequest', () => {
  const options = { model: MODEL, maxInputs: 3, maxChars: 5 };

  it('accepts a single string and arrays of strings, truncating each input', () => {
    expect(parseEmbeddingsRequest({ input: 'hello world' }, options).texts).toEqual(['hello']);
    expect(parseEmbeddingsRequest({ input: ['a', 'bcdefgh'], model: MODEL }, options).texts).toEqual([
      'a',
      'bcdef',
    ]);
    expect(parseEmbeddingsRequest({ input: ['x'], model: 'all-MiniLM-L6-v2' }, options).texts).toEqual(['x']);
  });

  it('rejects malformed, empty, oversized and foreign-model requests with 400', () => {
    const cases: unknown[] = [
      null,
      {},
      { input: 42 },
      { input: [] },
      { input: [1, 2, 3] },
      { input: ['a', 'b', 'c', 'd'] },
      { input: 'a', model: 'text-embedding-3-small' },
      { input: 'a', encoding_format: 'base64' },
    ];
    for (const body of cases) {
      expect(() => parseEmbeddingsRequest(body, options)).toThrowError(
        expect.objectContaining({ status: 400 }) as unknown as Error,
      );
    }
  });

  it('rejects a dimensions value that does not match the model', () => {
    expect(() =>
      parseEmbeddingsRequest({ input: 'a', dimensions: 1536 }, { ...options, dimensions: 384 }),
    ).toThrowError(/dimensions/);
    expect(
      parseEmbeddingsRequest({ input: 'a', dimensions: 384 }, { ...options, dimensions: 384 }).texts,
    ).toEqual(['a']);
  });
});

describe('truncateText', () => {
  it('does not split surrogate pairs', () => {
    expect(truncateText('ab\u{1F600}cd', 3)).toBe('ab');
    expect(truncateText('short', 10)).toBe('short');
  });
});

describe('shapeResponse', () => {
  it('produces the OpenAI embeddings envelope', () => {
    expect(shapeResponse(MODEL, { vectors: [[1], [2]], tokens: 7 }, 2)).toEqual({
      object: 'list',
      data: [
        { object: 'embedding', index: 0, embedding: [1] },
        { object: 'embedding', index: 1, embedding: [2] },
      ],
      model: MODEL,
      usage: { prompt_tokens: 7, total_tokens: 7 },
    });
    expect(() => shapeResponse(MODEL, { vectors: [[1]], tokens: 1 }, 2)).toThrow();
  });
});

describe('embeddings HTTP server', () => {
  it('embeds a batch and preserves input order', async () => {
    const embed = vi.fn(fakeEmbed);
    const url = await start({ embed });
    const { status, body } = await post(url, { model: MODEL, input: ['one', 'three three', 'xx'] });
    expect(status).toBe(200);
    expect(embed).toHaveBeenCalledWith(['one', 'three thre', 'xx']);
    expect(body.object).toBe('list');
    expect(body.model).toBe(MODEL);
    expect(body.data.map((d: { index: number }) => d.index)).toEqual([0, 1, 2]);
    expect(body.data[1].embedding).toEqual([10, 1, 0]);
    expect(body.usage).toEqual({ prompt_tokens: 3 + 4 + 3, total_tokens: 10 });
  });

  it('returns 400 JSON errors for invalid bodies', async () => {
    const url = await start();
    const invalidJson = await post(url, '{"input":');
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body.error.code).toBe('invalid_json');
    const tooMany = await post(url, { input: ['a', 'b', 'c', 'd', 'e'] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toMatch(/at most 4/);
    const wrongType = await post(url, { input: [1] });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.type).toBe('invalid_request_error');
  });

  it('returns 413 for bodies over the byte limit', async () => {
    const url = await start({ maxBodyBytes: 64 });
    const { status, body } = await post(url, { input: 'x'.repeat(200) });
    expect(status).toBe(413);
    expect(body.error.code).toBe('payload_too_large');
  });

  it('reports readiness and refuses to embed while the model loads', async () => {
    let ready = false;
    const embed = vi.fn(fakeEmbed);
    const url = await start({ isReady: () => ready, embed });
    expect((await fetch(`${url}/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/health/ready`)).status).toBe(503);
    const loading = await post(url, { input: 'a' });
    expect(loading.status).toBe(503);
    expect(embed).not.toHaveBeenCalled();
    ready = true;
    const readyRes = await fetch(`${url}/health/ready`);
    expect(readyRes.status).toBe(200);
    expect(await readyRes.json()).toMatchObject({ status: 'ok', model: MODEL, dimensions: 3 });
  });

  it('maps backend failures to 500 and exposes metrics', async () => {
    const url = await start({ embed: () => Promise.reject(new Error('boom')) });
    const failed = await post(url, { input: 'a' });
    expect(failed.status).toBe(500);
    expect(failed.body.error.type).toBe('server_error');
    const metrics = await (await fetch(`${url}/metrics`)).text();
    expect(metrics).toContain('embeddings_requests_total');
    expect(metrics).toContain('embedding_inference_seconds');
    expect(metrics).toContain('embeddings_inputs_total');
  });

  it('returns 404 for unknown routes and 405 for wrong methods', async () => {
    const url = await start();
    expect((await fetch(`${url}/nope`)).status).toBe(404);
    expect((await fetch(`${url}/v1/embeddings`)).status).toBe(405);
  });
});
