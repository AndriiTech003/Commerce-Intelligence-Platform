# 0019. zod schemas as the single source of contracts, OpenAPI and a typed client generated from them

- Status: accepted
- Date: 2026-10-02

## Context

The same shapes are used in many places: API request and response bodies, query strings, event
envelopes published by the collector and the outbox, messages parsed by consumers, admin forms, and
storefront calls. With separate definitions for each, they drift: a renamed field passes the backend tests
and breaks the admin at runtime, or a consumer silently accepts an event version it does not understand.

NestJS's usual answer is `class-validator` DTOs plus `@nestjs/swagger` decorators. That only covers HTTP,
does not run in the browser or in Fastify, and the decorators can disagree with the validation rules.

## Decision

One set of zod schemas in `packages/contracts` (isomorphic, no Node built-ins, enforced by the
`contracts-are-isomorphic` boundary rule):

- `src/api/*` — request, query and response schemas for auth, catalog, commerce and analytics;
- `src/events/*` — the event envelope, tracking events and domain event payloads (versioned);
- shared enums and helpers: order state machine, permissions, problem details, topology, Redis key builders.

From these:

1. **Validation**: controllers use `ZBody(schema)` / `ZQuery(schema)` pipes (`apps/api/src/shared/http/zod.ts`);
   the collector, stream-worker and domain-worker parse messages with the same schemas; a `ZodError` in a
   consumer is classified as poison (ADR 0006); the outbox writer validates payloads before insert.
2. **OpenAPI 3.1**: every route carries a `@Doc({ summary, tags, body, query, response, status, headers })`
   decorator (`apps/api/src/shared/http/doc.ts`) and a surface marker (`public`, `staff`, `storefront`,
   `platform`, `webhook`, ...). `apps/api/src/shared/http/openapi.ts` walks Nest controller metadata, converts
   schemas with `z.toJSONSchema`, adds the Problem Details error schema, and builds the document. It is served
   at `/openapi.json` and `/docs` and written to `packages/api-client/openapi.json` by `pnpm openapi`.
3. **Typed client**: `pnpm openapi` also runs `openapi-typescript` to generate `packages/api-client/src/schema.d.ts`.
   `packages/api-client` wraps `openapi-fetch` with auth/tenant middleware and an `ApiError` for Problem
   Details. Both `apps/admin` and `apps/storefront` call the API through it, so a contract change becomes a type error in the frontends.

## Alternatives considered

- **class-validator + @nestjs/swagger** — idiomatic Nest, but HTTP only, decorators duplicate the
  validation, and nothing is shared with the browser or the event consumers.
- **Code-first OpenAPI via a library (`zod-openapi`, `@asteasolutions/zod-to-openapi`)** — less custom code,
  but another abstraction over zod 4's built-in JSON Schema output, and it still needs route discovery from Nest.
- **Spec-first (hand-written OpenAPI, generate server types)** — good for public APIs with external
  consumers, but the schema is not executable validation, and it is heavier to keep in sync with event contracts.
- **tRPC / ts-rest** — end-to-end types without a spec, but no language-neutral contract for external clients and webhooks.

## Consequences

- Positive: one change in `packages/contracts` updates validation, docs and the client; drift becomes a compile or test error.
- Positive: the event contracts used by consumers are the same objects as those used by producers;
  contract fixtures in `packages/contracts/test/unit/events.test.ts` cover supported versions.
- Negative: the OpenAPI generator is our own code (~200 lines). Some zod features (transforms, refinements)
  have no JSON Schema equivalent and are emitted loosely (`unrepresentable: 'any'`).
- Negative: `openapi.json` and `schema.d.ts` are committed generated files; forgetting `pnpm openapi`
  after a change fails the unit test below, which is intended but adds a step.
- Negative: response schemas are documentation, not runtime checks; controllers are trusted to return the documented shape.
- Revisit when: the API gets external consumers who need versioning guarantees, or the custom generator becomes a maintenance burden.

## Verification

`apps/api/test/unit/openapi.test.ts`:

- "documents every route" — collects all controllers of `FEATURE_MODULES` and fails if any route lacks `@Doc` or a surface marker;
- "matches the committed openapi.json used to generate the typed client" — regenerates the document and
  compares it with `packages/api-client/openapi.json`, so the client cannot silently fall behind the API.

`apps/api/test/integration/catalog.test.ts` also fetches the served OpenAPI document and checks that every route is documented.
