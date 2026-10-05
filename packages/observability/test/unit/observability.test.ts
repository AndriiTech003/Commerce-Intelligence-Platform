import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EnvValidationError,
  createLogger,
  currentTraceparent,
  extractTraceContext,
  injectTraceContext,
  initMetrics,
  loadEnv,
  metricsText,
  runHealthChecks,
  startTelemetry,
  withSpan,
  counter,
} from '../../src';

describe('env', () => {
  it('fails fast with readable issues', () => {
    const schema = z.object({ DATABASE_URL: z.string().url(), PORT: z.coerce.number() });
    expect(() => loadEnv(schema, { PORT: 'x' })).toThrow(EnvValidationError);
    expect(loadEnv(schema, { DATABASE_URL: 'postgres://h/db', PORT: '1' })).toEqual({
      DATABASE_URL: 'postgres://h/db',
      PORT: 1,
    });
  });
});

describe('logger', () => {
  it('redacts secrets and emails', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger('test', { destination, context: () => ({ tenantId: 't1' }) });
    logger.info({ password: 'p', email: 'a@b.c', user: { token: 'x' } }, 'hello');
    const entry = JSON.parse(lines[0]!);
    expect(entry.password).toBe('[redacted]');
    expect(entry.email).toBe('[redacted]');
    expect(entry.user.token).toBe('[redacted]');
    expect(entry.tenantId).toBe('t1');
  });
});

describe('tracing', () => {
  it('propagates traceparent through a carrier', async () => {
    const telemetry = startTelemetry({ serviceName: 'test' });
    let inner: string | undefined;
    let carrier: Record<string, unknown> = {};
    await withSpan('outer', {}, async () => {
      carrier = injectTraceContext({});
      inner = currentTraceparent();
    });
    expect(String(carrier.traceparent)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(inner).toBe(carrier.traceparent);
    const ctx = extractTraceContext(carrier);
    await withSpan('child', { parent: ctx }, async () => {
      expect(currentTraceparent()?.split('-')[1]).toBe(String(carrier.traceparent).split('-')[1]);
    });
    await telemetry.shutdown();
  });
});

describe('metrics and health', () => {
  it('exposes registered metrics', async () => {
    initMetrics('test');
    counter('test_total', 'test counter').inc();
    const { body } = await metricsText();
    expect(body).toContain('test_total');
    expect(body).toContain('nodejs_eventloop_lag');
  });

  it('reports failing checks', async () => {
    const result = await runHealthChecks({
      ok: () => undefined,
      bad: () => {
        throw new Error('down');
      },
    });
    expect(result).toEqual({ ok: false, checks: { ok: 'ok', bad: 'down' } });
  });
});
