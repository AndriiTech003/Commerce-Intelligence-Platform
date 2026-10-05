import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { counter, histogram, metricsText, type Logger } from '@cip/observability';
import { z } from 'zod';

export interface EmbedResult {
  vectors: number[][];
  tokens: number;
}

export type EmbedFn = (texts: string[]) => Promise<EmbedResult>;

export interface EmbeddingsServerOptions {
  embed: EmbedFn;
  model: string;
  isReady?: () => boolean;
  dimensions?: () => number | undefined;
  maxInputs?: number;
  maxChars?: number;
  maxBodyBytes?: number;
  logger?: Logger;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly type = 'invalid_request_error',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface EmbeddingsResponse {
  object: 'list';
  data: Array<{ object: 'embedding'; index: number; embedding: number[] }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

const metrics = () => ({
  requests: counter('embeddings_requests_total', 'Embedding requests', ['status']),
  inputs: counter('embeddings_inputs_total', 'Texts embedded'),
  inference: histogram(
    'embedding_inference_seconds',
    'Embedding inference duration per request',
    [],
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  ),
});

export function buildRequestSchema(maxInputs: number) {
  return z.object({
    model: z.string().optional(),
    input: z.union([
      z.string(),
      z
        .array(z.string(), { error: 'input must be a string or an array of strings' })
        .min(1, 'input must not be empty')
        .max(maxInputs, `at most ${maxInputs} inputs are allowed per request`),
    ]),
    encoding_format: z.literal('float', { error: 'only encoding_format "float" is supported' }).optional(),
    dimensions: z.number().int().positive().optional(),
    user: z.string().optional(),
  });
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function modelMatches(requested: string, model: string): boolean {
  const short = model.split('/').pop() ?? model;
  return requested === model || requested === short;
}

export interface ParsedRequest {
  texts: string[];
}

export function parseEmbeddingsRequest(
  body: unknown,
  options: { model: string; maxInputs: number; maxChars: number; dimensions?: number | undefined },
): ParsedRequest {
  const result = buildRequestSchema(options.maxInputs).safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${path}${issue?.message ?? 'invalid request'}`, 'invalid_request');
  }
  const request = result.data;
  if (request.model !== undefined && !modelMatches(request.model, options.model)) {
    throw new HttpError(
      400,
      `model "${request.model}" is not served here (serving "${options.model}")`,
      'model_not_found',
    );
  }
  if (
    request.dimensions !== undefined &&
    options.dimensions !== undefined &&
    request.dimensions !== options.dimensions
  ) {
    throw new HttpError(
      400,
      `dimensions ${request.dimensions} is not supported (model has ${options.dimensions})`,
      'invalid_dimensions',
    );
  }
  const inputs = typeof request.input === 'string' ? [request.input] : request.input;
  return { texts: inputs.map((text) => truncateText(text, options.maxChars)) };
}

export function shapeResponse(model: string, result: EmbedResult, expected: number): EmbeddingsResponse {
  if (result.vectors.length !== expected) {
    throw new HttpError(
      500,
      'embedding backend returned an unexpected number of vectors',
      'internal_error',
      'server_error',
    );
  }
  return {
    object: 'list',
    data: result.vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
    model,
    usage: { prompt_tokens: result.tokens, total_tokens: result.tokens },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendError(res: ServerResponse, error: HttpError): void {
  sendJson(res, error.status, { error: { message: error.message, type: error.type, code: error.code } });
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes) {
      reject(new HttpError(413, `request body exceeds ${maxBytes} bytes`, 'payload_too_large'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(new HttpError(413, `request body exceeds ${maxBytes} bytes`, 'payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

export function createEmbeddingsServer(options: EmbeddingsServerOptions): Server {
  const maxInputs = options.maxInputs ?? 128;
  const maxChars = options.maxChars ?? 2000;
  const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const isReady = options.isReady ?? (() => true);
  const m = metrics();

  async function handleEmbeddings(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, maxBodyBytes);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'request body must be valid JSON', 'invalid_json');
    }
    const { texts } = parseEmbeddingsRequest(body, {
      model: options.model,
      maxInputs,
      maxChars,
      dimensions: options.dimensions?.(),
    });
    if (!isReady()) throw new HttpError(503, 'model is still loading', 'model_loading', 'server_error');
    const stop = m.inference.startTimer();
    let result: EmbedResult;
    try {
      result = await options.embed(texts);
    } finally {
      stop();
    }
    m.inputs.inc(texts.length);
    sendJson(res, 200, shapeResponse(options.model, result, texts.length));
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/v1/embeddings' || path === '/embeddings') {
      if (req.method !== 'POST') throw new HttpError(405, 'use POST', 'method_not_allowed');
      try {
        await handleEmbeddings(req, res);
        m.requests.inc({ status: '200' });
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        m.requests.inc({ status: String(status) });
        throw error;
      }
      return;
    }
    if (req.method !== 'GET') throw new HttpError(405, 'method not allowed', 'method_not_allowed');
    if (path === '/health/live') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    if (path === '/health/ready') {
      const ready = isReady();
      sendJson(res, ready ? 200 : 503, {
        status: ready ? 'ok' : 'loading',
        model: options.model,
        dimensions: options.dimensions?.() ?? null,
      });
      return;
    }
    if (path === '/metrics') {
      const { contentType, body } = await metricsText();
      res.writeHead(200, { 'content-type': contentType }).end(body);
      return;
    }
    if (path === '/v1/models') {
      sendJson(res, 200, {
        object: 'list',
        data: [{ id: options.model, object: 'model', owned_by: 'local', ready: isReady() }],
      });
      return;
    }
    throw new HttpError(404, 'not found', 'not_found');
  }

  return createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        if (error.status === 413) res.setHeader('connection', 'close');
        sendError(res, error);
        return;
      }
      options.logger?.error({ err: error }, 'embedding request failed');
      sendError(res, new HttpError(500, 'internal error', 'internal_error', 'server_error'));
    });
  });
}

export function listen(server: Server, port: number, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve(`http://${host}:${actualPort}`);
    });
  });
}

export function stopServer(server: Server, graceMs = 10000): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}
