# 0002. Shared schema with tenant_id, enforced by PostgreSQL Row-Level Security

- Status: accepted
- Date: 2026-10-02

## Context

Every merchant (tenant) shares one database. A single missing `where tenant_id = …` in a query would
leak orders, customers or API keys across stores. Code review and conventions reduce that risk but cannot
eliminate it, and the project has dozens of repositories with hand-written SQL.

The API uses a connection pool. Any per-request database setting must not survive on a pooled connection
and leak into the next request, which may belong to another tenant.

## Decision

One schema, a `tenant_id uuid not null` column on every tenant table, and PostgreSQL RLS as the enforcement
layer. Migration `apps/api/src/db/migrations/0002_rls_roles_outbox.sql`:

- creates role `app_user` (`NOBYPASSRLS`) used by the API for all tenant traffic, and role `app_system`
  (`BYPASSRLS`) used by workers and for system lookups such as API-key resolution and the outbox relay;
- runs `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` on all 26 tenant tables (the list
  is `TENANT_TABLES` in `apps/api/src/db/schema.ts`), so even the table owner is subject to the policy;
- creates `tenant_isolation` policies `USING / WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`.
  `current_setting` without `missing_ok` **throws** when the setting is absent, so a query without
  tenant context fails instead of returning everything;
- for `memberships`, `USING` also allows rows where `user_id = current_setting('app.user_id', true)`, so
  the "list my stores" query works before a tenant is selected. `WITH CHECK` still requires the tenant.

Per request, `withTenant()` in `apps/api/src/modules/tenancy/infrastructure/tenant-database.ts` opens a
transaction, calls `select set_config('app.tenant_id', $1, true)` (the `true` makes it `SET LOCAL`), and
stores the transaction in `AsyncLocalStorage`. Repositories obtain the transaction via `tx()`; it throws
if there is none. The setting ends with the transaction, so it never leaks across pooled connections.
`outbox`, `processed_messages`, `tenants`, `users` and payment webhook dedupe rows are intentionally
not tenant-scoped; they are written inside tenant transactions or read only by system roles.

## Alternatives considered

- **Schema per tenant** — strong isolation and easy per-tenant export, but N schemas to migrate, catalog
  bloat, and pooled connections need `search_path` juggling. Painful beyond a few hundred tenants.
- **Database per tenant** — strongest isolation and noisy-neighbour control, but highest cost and
  operational load; cross-tenant platform queries become fan-out jobs.
- **Application-level filtering only** — no database overhead, but one forgotten `where` is a data leak.

## Consequences

- Positive: isolation holds even when application code has a bug; it is checked by the database.
- Positive: one migration path and cheap tenants; seed and tests create tenants freely.
- Negative: every tenant query must run inside a transaction (`SET LOCAL` requires one). Reads pay a
  `BEGIN/COMMIT` round trip.
- Negative: RLS adds predicate overhead and can affect plans. Measured on 2026-10-05 with
  `scripts/rls-bench.mjs` (interleaved RLS vs a non-RLS copy, bootstrap CIs, `docs/assets/rls-bench*.md`): the
  statements themselves cost 2–9% more for point lookups, and the extra `set_config` round trip adds ≈ 0.05 ms per
  transaction (+21–37% on 0.15–0.25 ms lookups); endpoints pay +3–11% at p50. Policies must wrap
  `current_setting()` in a scalar subquery (migration `0005`): calling it per row made list endpoints 26–43% slower.
- Negative: noisy neighbours share one Postgres instance; there is no per-tenant resource limit.
- Negative: `app_system` bypasses RLS, so system code paths (workers, key lookup) must filter by tenant
  explicitly. They are kept small and covered by integration tests.
- Revisit when: a tenant needs physical isolation (compliance, size), or RLS overhead shows up in profiles.

## Verification

`apps/api/test/integration/tenant-isolation.test.ts` seeds a row into every tenant table for two tenants and checks:

- every table in `TENANT_TABLES` has RLS enabled and forced, and has a policy;
- for each table, an unfiltered `select *` in tenant A's context returns only A's rows;
- a query without tenant context throws instead of leaking;
- inserting a row with another tenant's id is rejected by `WITH CHECK`; updates and deletes of B's rows affect nothing;
- via the API: staff of A sending `X-Tenant-Id` of B gets 403; A requesting B's order id gets 404; a
  storefront of A cannot read B's product by slug.

The Playwright test "RunHub staff cannot see HomeBrew orders, not even by URL" (`e2e/commerce.e2e.ts`) checks the same in the UI.
