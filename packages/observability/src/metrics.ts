import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import client from 'prom-client';

export const registry = new client.Registry();
let defaultsCollected = false;

export function initMetrics(service: string): client.Registry {
  if (!defaultsCollected) {
    registry.setDefaultLabels({ service });
    client.collectDefaultMetrics({ register: registry, eventLoopMonitoringPrecision: 20 });
    defaultsCollected = true;
  }
  return registry;
}

function getOrCreate<T extends client.Metric>(name: string, create: () => T): T {
  const existing = registry.getSingleMetric(name);
  return (existing as T | undefined) ?? create();
}

export function counter<L extends string>(name: string, help: string, labelNames: readonly L[] = []) {
  return getOrCreate(name, () => new client.Counter<L>({ name, help, labelNames, registers: [registry] }));
}

export function gauge<L extends string>(name: string, help: string, labelNames: readonly L[] = []) {
  return getOrCreate(name, () => new client.Gauge<L>({ name, help, labelNames, registers: [registry] }));
}

export function histogram<L extends string>(
  name: string,
  help: string,
  labelNames: readonly L[] = [],
  buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
) {
  return getOrCreate(
    name,
    () => new client.Histogram<L>({ name, help, labelNames, buckets, registers: [registry] }),
  );
}

export const httpMetrics = () => ({
  requests: counter('http_requests_total', 'HTTP requests', ['method', 'route', 'status']),
  duration: histogram('http_request_duration_seconds', 'HTTP request duration', [
    'method',
    'route',
    'status',
  ]),
});

export async function metricsText(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}

export type HealthCheck = () => Promise<void> | void;

export interface OpsServerOptions {
  port: number;
  host?: string;
  ready: Record<string, HealthCheck>;
}

export async function runHealthChecks(
  checks: Record<string, HealthCheck>,
): Promise<{ ok: boolean; checks: Record<string, string> }> {
  const results: Record<string, string> = {};
  let ok = true;
  await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        await Promise.race([
          Promise.resolve(check()),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000).unref()),
        ]);
        results[name] = 'ok';
      } catch (error) {
        ok = false;
        results[name] = (error as Error).message || 'failed';
      }
    }),
  );
  return { ok, checks: results };
}

export function startOpsServer(options: OpsServerOptions): Promise<Server> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.url === '/metrics') {
        const { contentType, body } = await metricsText();
        res.writeHead(200, { 'content-type': contentType }).end(body);
        return;
      }
      if (req.url === '/health/live') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (req.url === '/health/ready') {
        const result = await runHealthChecks(options.ready);
        res
          .writeHead(result.ok ? 200 : 503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: result.ok ? 'ok' : 'unavailable', checks: result.checks }));
        return;
      }
      res.writeHead(404).end();
    })().catch(() => {
      res.writeHead(500).end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '127.0.0.1', () => resolve(server));
  });
}

export { client as promClient };
