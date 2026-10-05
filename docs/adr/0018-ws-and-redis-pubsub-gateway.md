# 0018. `ws` + Redis pub/sub for the realtime gateway

- Status: accepted
- Date: 2026-10-02

## Context

The admin Live dashboard shows events/sec, active visitors, revenue and a feed of recent events, updated
every second. The data is produced by the stream-worker, which aggregates per-second counters in Redis and
publishes one tick per tenant per second plus feed items (`apps/stream-worker/src/realtime.ts`).

Constraints: the gateway is a separate process with a different load profile from the API (ADR 0001); it must
scale horizontally behind a load balancer without sticky routing of producers; a tenant's staff must never
receive another tenant's data; and browsers cannot set an `Authorization` header on a WebSocket handshake,
while a JWT in the URL ends up in proxy logs.

The data is **one-directional**: server → browser. The only client messages today are `pause` / `resume`
(tab hidden or visible) and an application-level `ping`.

## Decision

A small Node service, `apps/realtime-gateway`, on the plain `ws` library with Redis pub/sub as the fan-out bus.

- **Ticket auth** (`gateway.ts`): the admin calls `POST /v1/admin/realtime/ticket` (permission
  `analytics:read`) and gets a random 24-byte ticket stored in Redis as `{tenantId, userId}` for 30 seconds.
  The browser connects to `/ws?ticket=…`; the gateway does `GETDEL` during the HTTP upgrade, so a ticket is
  single-use and short-lived, and answers `401` before the upgrade if it is missing or unknown. The tenant comes
  from the ticket, never from the client.
- **Tenant channels**: producers publish to `rt:{tenantId}:tick` and `rt:{tenantId}:events`. Each gateway
  instance `PSUBSCRIBE`s to both patterns once, parses the tenant from the channel name (`channels.ts`) and
  writes only to sockets registered under that tenant. Any instance can serve any tenant, so scaling out is
  "add instances"; Redis delivers every message to every instance.
- **Heartbeat and backpressure**: a protocol-level `ping` every `HEARTBEAT_MS` (15 s); a socket that did not
  answer the previous ping is terminated. If a socket's `bufferedAmount` exceeds `MAX_BUFFERED_BYTES` (1 MiB),
  messages to it are dropped (`ws_messages_dropped_total`) instead of growing memory. Paused sockets get
  nothing.
- **Resume after gaps**: pub/sub is fire-and-forget, so nothing is replayed by the gateway. The admin hook
  `useLiveChannel` (`apps/admin/src/lib/use-live-channel.ts`) reconnects with backoff and jitter, fetches a new
  ticket each time, and on open resyncs the recent series and feed from REST `analytics/live`.
- Metrics: `ws_connections`, `ws_messages_sent_total{kind}`, `ws_messages_dropped_total`; `/health` checks
  both Redis connections.

## Alternatives considered

- **Server-Sent Events** — honestly, SSE would fit this data just as well: one-directional, auto-reconnect with
  `Last-Event-ID` built into the browser, plain HTTP through every proxy, and the `pause` message could be
  replaced by closing and reopening the stream. We kept WebSocket because the Live screen is planned to send
  commands later (simulator start/stop and rate, persona shifts, replaying DLQ messages with live progress),
  and because the ticket and heartbeat code would be the same. If those commands end up as plain REST calls,
  SSE is the simpler choice and this ADR should be superseded.
- **Socket.IO** — rooms, reconnection and fallbacks out of the box, but its own protocol on top of WebSocket
  (clients must use its library), a Redis adapter for multi-instance, and more than we need for two message
  types.
- **Gateway subscribing to RabbitMQ** — durable, but every instance needs its own exclusive queue and binding,
  and durability buys nothing for one-second ticks that are stale after a second.
- **Polling `analytics/live`** — simplest, but one request per admin per second against the API, and the feed
  rate limit (one row per 200 ms in the UI) would be visible as jumps.

## Consequences

- Positive: the gateway is ~160 lines, stateless, and holds no tenant data beyond the open sockets.
- Positive: tenant isolation is by construction: a socket is bound to the tenant from a server-issued ticket.
- Positive: horizontal scaling needs no sticky sessions on the producer side.
- Negative: Redis pub/sub has no delivery guarantee; a gateway restart or Redis failover loses messages in
  flight. The REST resync covers it, and ticks are idempotent by timestamp.
- Negative: every instance receives every tenant's messages, even for tenants with no connected users. Fine at
  this scale; with thousands of tenants we would subscribe per tenant on first connection instead of by pattern.
- Negative: a load balancer must support WebSocket upgrades and long idle connections; the 15 s heartbeat keeps
  idle-timeout proxies from cutting them.
- Revisit when: no client → server commands materialise (switch to SSE), or the number of tenants makes
  pattern subscription wasteful.

## Verification

- `apps/realtime-gateway/test/integration/gateway.test.ts` against real Redis:
  - "rejects connections without a valid ticket and tickets are single use" — a bogus ticket gets 401, a valid
    one connects once, reusing it gets 401;
  - "delivers ticks only to sockets of the same tenant and honours pause" — a tick published for tenant A
    reaches A's socket and not B's; after `pause` nothing is delivered; `ping` gets `pong`;
  - "keeps live connections with heartbeats and exposes metrics".
- `apps/realtime-gateway/test/unit/channels.test.ts` — tenant extraction from prefixed channel names and
  defensive ticket parsing.
- `apps/api/test/integration/pipeline.test.ts` checks the path from an order to a realtime update end to end.
