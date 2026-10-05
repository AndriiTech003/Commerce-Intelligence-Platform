import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { enableAutoInstrumentation } from './auto-instrumentation';

let provider: NodeTracerProvider | null = null;

export interface TelemetryOptions {
  serviceName: string;
  otlpEndpoint?: string | undefined;
  autoInstrument?: boolean;
}

export function startTelemetry(options: TelemetryOptions): { shutdown(): Promise<void> } {
  if (provider) return { shutdown: () => provider?.shutdown() ?? Promise.resolve() };
  if (options.autoInstrument ?? Boolean(options.otlpEndpoint)) enableAutoInstrumentation();
  const spanProcessors: SpanProcessor[] = [];
  if (options.otlpEndpoint) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${options.otlpEndpoint.replace(/\/$/, '')}/v1/traces` }),
      ),
    );
  }
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: options.serviceName }),
    spanProcessors,
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  return {
    shutdown: async () => {
      await provider?.shutdown();
      provider = null;
    },
  };
}

export function tracer(name = 'cip') {
  return trace.getTracer(name);
}

export type Carrier = Record<string, unknown>;

const setter = {
  set(carrier: Carrier, key: string, value: string) {
    carrier[key] = value;
  },
};

const getter = {
  keys(carrier: Carrier) {
    return Object.keys(carrier);
  },
  get(carrier: Carrier, key: string) {
    const value = carrier[key] ?? carrier[key.toLowerCase()];
    if (Array.isArray(value)) return value.map(String);
    if (value === undefined || value === null) return undefined;
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    return String(value);
  },
};

export function injectTraceContext(carrier: Carrier = {}, ctx: Context = context.active()): Carrier {
  propagation.inject(ctx, carrier, setter);
  return carrier;
}

export function extractTraceContext(carrier: Carrier | undefined): Context {
  return propagation.extract(context.active(), carrier ?? {}, getter);
}

export function currentTraceparent(): string | undefined {
  const carrier: Carrier = {};
  injectTraceContext(carrier);
  return typeof carrier.traceparent === 'string' ? carrier.traceparent : undefined;
}

export function currentTraceId(): string | undefined {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && ctx.traceId !== '00000000000000000000000000000000' ? ctx.traceId : undefined;
}

export async function withSpan<T>(
  name: string,
  options: { kind?: SpanKind; attributes?: Attributes; parent?: Context },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = options.parent ?? context.active();
  const span = tracer().startSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    parent,
  );
  return context.with(trace.setSpan(parent, span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export { SpanKind, context, trace };
