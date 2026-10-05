import { createServer, type IncomingMessage, type Server } from 'node:http';
import { redisKeys } from '@cip/contracts';
import { counter, createLogger, gauge, initMetrics, metricsText, type Logger } from '@cip/observability';
import { Redis } from 'ioredis';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseTicket, tenantFromChannel } from './channels';
import type { GatewayConfig } from './config';

interface Client {
  socket: WebSocket;
  tenantId: string;
  userId: string;
  alive: boolean;
  paused: boolean;
}

export interface RunningGateway {
  url: string;
  logger: Logger;
  clients(): number;
  stop(): Promise<void>;
}

const connections = gauge('ws_connections', 'Open WebSocket connections');
const sent = counter('ws_messages_sent_total', 'Messages pushed to WebSocket clients', ['kind']);
const dropped = counter('ws_messages_dropped_total', 'Messages dropped because of slow clients');

export async function startGateway(config: GatewayConfig): Promise<RunningGateway> {
  initMetrics('realtime-gateway');
  const logger = createLogger('realtime-gateway', { level: config.LOG_LEVEL });
  const keys = redisKeys(config.REDIS_PREFIX);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  const subscriber = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const byTenant = new Map<string, Set<Client>>();

  const http: Server = createServer((req, res) => {
    void (async () => {
      if (req.url === '/health/live') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
        return;
      }
      if (req.url === '/health/ready') {
        const ok = subscriber.status === 'ready' && redis.status === 'ready';
        res
          .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: ok ? 'ok' : 'unavailable' }));
        return;
      }
      if (req.url === '/metrics') {
        const { contentType, body } = await metricsText();
        res.writeHead(200, { 'content-type': contentType }).end(body);
        return;
      }
      res.writeHead(404).end();
    })();
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req: IncomingMessage, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      const ticket = url.searchParams.get('ticket') ?? '';
      const payload = ticket ? parseTicket(await redis.getdel(keys.wsTicket(ticket))) : null;
      if (!payload) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = {
          socket: ws,
          tenantId: payload.tenantId,
          userId: payload.userId,
          alive: true,
          paused: false,
        };
        const set = byTenant.get(client.tenantId) ?? new Set<Client>();
        set.add(client);
        byTenant.set(client.tenantId, set);
        connections.inc();
        ws.on('pong', () => {
          client.alive = true;
        });
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(String(data)) as { type?: string };
            if (message.type === 'pause') client.paused = true;
            if (message.type === 'resume') client.paused = false;
            if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          } catch {
            return;
          }
        });
        ws.on('close', () => {
          set.delete(client);
          if (set.size === 0) byTenant.delete(client.tenantId);
          connections.dec();
        });
        ws.send(JSON.stringify({ type: 'hello', tenantId: client.tenantId, serverTime: Date.now() }));
      });
    })().catch((error: unknown) => {
      logger.warn({ err: error }, 'upgrade failed');
      socket.destroy();
    });
  });

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const target = tenantFromChannel(channel, config.REDIS_PREFIX);
    if (!target) return;
    const clients = byTenant.get(target.tenantId);
    if (!clients) return;
    for (const client of clients) {
      if (client.paused || client.socket.readyState !== client.socket.OPEN) continue;
      if (client.socket.bufferedAmount > config.MAX_BUFFERED_BYTES) {
        dropped.inc();
        continue;
      }
      client.socket.send(message);
      sent.inc({ kind: target.kind });
    }
  });
  await subscriber.psubscribe(keys.tickPattern(), keys.eventsPattern());

  const heartbeat = setInterval(() => {
    for (const set of byTenant.values()) {
      for (const client of set) {
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
    }
  }, config.HEARTBEAT_MS);

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(config.GATEWAY_PORT, config.GATEWAY_HOST, () => resolve());
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : config.GATEWAY_PORT;
  const url = `ws://${config.GATEWAY_HOST}:${port}/ws`;
  logger.info({ url }, 'realtime-gateway listening');
  return {
    url,
    logger,
    clients: () => [...byTenant.values()].reduce((sum, set) => sum + set.size, 0),
    stop: async () => {
      clearInterval(heartbeat);
      for (const set of byTenant.values())
        for (const client of set) client.socket.close(1001, 'server shutting down');
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      subscriber.disconnect();
      redis.disconnect();
    },
  };
}
