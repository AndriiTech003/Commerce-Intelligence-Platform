import { trace } from '@opentelemetry/api';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

export interface LoggerContextSource {
  (): Record<string, unknown> | undefined;
}

export const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'email',
  '*.email',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.cookie',
];

export function createLogger(
  service: string,
  options: { level?: string; context?: LoggerContextSource; destination?: DestinationStream } = {},
): Logger {
  const config: LoggerOptions = {
    name: service,
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const span = trace.getActiveSpan();
      const ctx = span?.spanContext();
      const extra = options.context?.() ?? {};
      return ctx && ctx.traceId !== '00000000000000000000000000000000'
        ? { traceId: ctx.traceId, spanId: ctx.spanId, ...extra }
        : extra;
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
