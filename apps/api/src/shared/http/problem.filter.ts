import { Catch, HttpException, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { InvalidTransitionError, problemType, type Problem } from '@cip/contracts';
import { currentTraceId, type Logger } from '@cip/observability';
import type { Request, Response } from 'express';
import { DomainError } from '../errors';
import { LOGGER } from '../tokens';

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  412: 'Precondition failed',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable entity',
  428: 'Precondition required',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

function humanize(code: string): string {
  const text = code.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function httpCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
  }
}

export function toProblem(
  exception: unknown,
  instance: string,
): { problem: Problem; headers: Record<string, string> } {
  const traceId = currentTraceId();
  const base = (
    status: number,
    code: string,
    detail: string,
    errors?: Array<Record<string, unknown>>,
  ): Problem => ({
    type: problemType(code),
    title: TITLES[status] ?? humanize(code),
    status,
    code,
    detail,
    instance,
    ...(traceId ? { traceId } : {}),
    ...(errors ? { errors } : {}),
  });
  if (exception instanceof DomainError) {
    return {
      problem: {
        ...base(exception.status, exception.code, exception.message, exception.errors),
        title: humanize(exception.code),
      },
      headers: exception.headers ?? {},
    };
  }
  if (exception instanceof InvalidTransitionError) {
    return {
      problem: { ...base(409, 'INVALID_TRANSITION', exception.message), title: 'Invalid transition' },
      headers: {},
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const detail =
      typeof response === 'string'
        ? response
        : String((response as { message?: unknown }).message ?? exception.message);
    return { problem: base(status, httpCode(status), detail), headers: {} };
  }
  const raw = exception as { cause?: unknown };
  const pg = (
    raw && typeof raw === 'object' && raw.cause && typeof raw.cause === 'object' && 'code' in raw.cause
      ? raw.cause
      : exception
  ) as {
    code?: string;
    detail?: string;
    message?: string;
    constraint?: string;
  };
  if (pg && typeof pg.code === 'string') {
    if (pg.code === '23505')
      return { problem: base(409, 'CONFLICT', pg.detail ?? 'Resource already exists'), headers: {} };
    if (pg.code === '23503')
      return {
        problem: base(409, 'CONFLICT', pg.detail ?? 'Referenced resource does not exist'),
        headers: {},
      };
    if (pg.code === '23514')
      return {
        problem: base(409, 'CONFLICT', `Constraint ${pg.constraint ?? ''} violated`.trim()),
        headers: {},
      };
    if (pg.code === '42501')
      return { problem: base(403, 'FORBIDDEN', 'Row-level security policy violation'), headers: {} };
    if (pg.code === '22P02')
      return { problem: base(400, 'VALIDATION_FAILED', 'Invalid identifier'), headers: {} };
  }
  if (exception instanceof SyntaxError && 'body' in (exception as object)) {
    return { problem: base(400, 'VALIDATION_FAILED', 'Malformed JSON body'), headers: {} };
  }
  return { problem: base(500, 'INTERNAL', 'Internal server error'), headers: {} };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    if (response.headersSent) return;
    const { problem, headers } = toProblem(exception, request.originalUrl?.split('?')[0] ?? request.url);
    if (problem.status >= 500)
      this.logger.error({ err: exception, path: request.originalUrl }, 'request failed');
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.status(problem.status).type('application/problem+json').send(JSON.stringify(problem));
  }
}
