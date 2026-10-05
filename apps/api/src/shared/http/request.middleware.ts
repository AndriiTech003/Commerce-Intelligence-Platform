import { uuidv7, uuidRegex } from '@cip/contracts';
import {
  context,
  currentTraceparent,
  extractTraceContext,
  httpMetrics,
  SpanKind,
  trace,
  tracer,
} from '@cip/observability';
import type { NextFunction, Request, Response } from 'express';
import { newContext, requestContext } from '../request-context';

export const ANON_COOKIE = 'cip_aid';

function anonymousIdFrom(req: Request): string | null {
  const header = req.headers['x-anonymous-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[ANON_COOKIE];
  const candidate = fromHeader ?? fromCookie ?? null;
  return candidate && uuidRegex.test(candidate) ? candidate.toLowerCase() : null;
}

export function requestMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : uuidv7();
  res.setHeader('X-Request-Id', requestId);
  const parent = extractTraceContext(req.headers as Record<string, unknown>);
  const span = tracer().startSpan(`${req.method} ${req.path}`, { kind: SpanKind.SERVER }, parent);
  const spanContext = trace.setSpan(parent, span);
  const started = process.hrtime.bigint();
  const metrics = httpMetrics();
  res.on('finish', () => {
    const route = ((req as Request & { route?: { path?: string } }).route?.path ?? 'unmatched').toString();
    const labels = {
      method: req.method,
      route: `${req.baseUrl ?? ''}${route}`,
      status: String(res.statusCode),
    };
    metrics.requests.inc(labels);
    metrics.duration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
    span.setAttribute('http.route', labels.route);
    span.setAttribute('http.response.status_code', res.statusCode);
    span.end();
  });
  context.with(spanContext, () => {
    const traceparent = currentTraceparent();
    if (traceparent) res.setHeader('traceparent', traceparent);
    const ctx = newContext({ requestId, ip: req.ip ?? null, anonymousId: anonymousIdFrom(req) });
    requestContext.run(ctx, () => next());
  });
}
