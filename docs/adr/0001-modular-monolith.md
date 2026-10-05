# 0001. Modular monolith for domain logic, separate services only for different load profiles

- Status: accepted
- Date: 2026-10-02

## Context

The platform has roughly fifteen bounded contexts (tenancy, identity, access, audit, catalog, inventory,
cart, discounts, checkout, payments, orders, customers, analytics, personalization, campaigns, ...).
The most important flow, checkout, touches four of them at once: it reprices the cart, validates and
redeems a discount, reserves stock and creates the order. All of that must be atomic: an order without
a reservation, or a redeemed discount without an order, is a bug.

The project is built and operated by one engineer. Every additional deployable adds a pipeline, config,
health checks, dashboards and failure modes. At the same time, some parts of the system have a very
different runtime profile from the request/response API: high-volume event ingestion, long-running
consumers, stateful WebSocket connections, and a traffic generator.

## Decision

All domain logic lives in one NestJS application, `apps/api`, split into modules under
`apps/api/src/modules/*`. Each module has four layers:

- `domain/` — entities, value objects, domain errors; no Nest, no database, no I/O.
- `application/` — use cases and ports (repository interfaces).
- `infrastructure/` — Drizzle repositories and external clients.
- `http/` — controllers, zod DTOs, mapping.

Modules expose a public `index.ts`; nothing else in a module is importable from another module.
Checkout (`modules/checkout/application/checkout.service.ts`) runs one Postgres transaction through the
`UnitOfWork` port and calls the cart, inventory, discounts and orders services inside it.

Separate processes exist only where the load profile or lifecycle differs:

| Service | Why it is separate |
|---|---|
| `apps/collector` (Fastify) | many small tracking requests; must keep accepting events if the API is down |
| `apps/stream-worker` | batch inserts into ClickHouse and Redis counters; CPU/IO isolated from the API |
| `apps/domain-worker` | outbox relay, email notifications, reservation expiry; background jobs with retries |
| `apps/realtime-gateway` | long-lived WebSocket connections, separate from the stateless API |
| `apps/simulator` | demo/load traffic only |

The layer rules are enforced by `dependency-cruiser` (`.dependency-cruiser.cjs`, run with `pnpm boundaries`,
also part of `pnpm lint`):

- `domain-is-pure` — `domain/` must not import other layers, `src/db`, Nest, Drizzle, pg, ioredis, amqplib or ClickHouse.
- `application-not-infrastructure` and `http-not-infrastructure` — no direct access to repositories or the schema.
- `modules-talk-through-index` — cross-module imports only via `modules/<name>/index.ts`.
- `db-schema-only-in-infrastructure` — `src/db/schema` is visible only to infrastructure code.
- `apps-are-isolated` — an app never imports another app's source; shared code goes to `packages/*`.
- `packages-do-not-import-apps`, `contracts-are-isomorphic`, `tracker-sdk-has-no-dependencies`, `no-circular-in-packages`.

## Alternatives considered

- **Microservice per bounded context** — independent deploys and scaling, but checkout would need a saga
  with compensations across four services to get what one `BEGIN … COMMIT` gives for free. Much more
  infrastructure for no user-visible benefit at this scale.
- **Plain monolith without enforced boundaries** — fastest to start, but layers erode quickly; a later
  extraction would be expensive. Convention alone does not survive deadline pressure.
- **Nx with module boundary tags** — similar enforcement, but heavier tooling than pnpm + Turborepo needs.

## Consequences

- Positive: checkout and order transitions are single ACID transactions; there is no distributed
  transaction anywhere in the domain.
- Positive: modules can be extracted later along their `index.ts` boundary, because no one reaches into internals.
- Negative: the API deploys as one unit; a bad change in campaigns redeploys checkout too.
- Negative: one module's heavy query can affect the others (shared pool). Analytics queries go to ClickHouse,
  which removes the biggest offender.
- Negative: the bandit feedback consumer currently runs inside the API process (`CONSUMERS_ENABLED`), so
  consumer load shares CPU with HTTP handling. It can be moved to a worker without code changes in the domain.
- Revisit when: a module needs a different release cadence or team ownership, or one module's resource
  usage starts to dominate the API (for example, decision-API latency suffering from admin traffic).

## Verification

- `pnpm boundaries` fails the build on any forbidden import listed above.
- `apps/api/test/integration/checkout.test.ts` proves the single-transaction checkout invariants
  (no overselling, no partial orders) that a service split would have made much harder to guarantee.
