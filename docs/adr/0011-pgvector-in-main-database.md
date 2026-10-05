# 0011. pgvector in the main PostgreSQL database for product embeddings

- Status: accepted
- Date: 2026-10-02

## Context

Two recommendation strategies need nearest-neighbour search over product embeddings: `vector_profile`
("For you": a weighted average of the last 10 products the shopper touched) and `vector_item` ("Similar" on
the PDP). A useful neighbour is not just close in vector space: it must belong to the current tenant, be
`active`, have at least one variant in stock, and not be the product on screen. Stock lives in
`inventory_items` and changes with every checkout (ADR 0021).

The scale is modest: the demo seeds 300 + 150 products, and a realistic tenant has thousands to tens of
thousands of SKUs. The whole platform stays well under 1M vectors. The team is one person, and every extra
datastore costs operations time (ADR 0008 already added ClickHouse).

## Decision

Store embeddings in `products.embedding` and query them with pgvector in the same Postgres that holds the
catalog and inventory.

- Migration `apps/api/src/db/migrations/0003_personalization_campaigns_webhooks.sql` sets the column to
  `vector(384)`, adds `embedding_source_hash`, and creates the HNSW index `products_embedding_idx` with
  `vector_cosine_ops`. The Postgres image is `pgvector/pgvector:pg16` (`infra/docker/postgres.Dockerfile`).
- `DrizzleCandidateQueries.nearest()` in
  `apps/api/src/modules/personalization/infrastructure/candidate.queries.ts` runs one SQL statement:
  `order by embedding <=> $v` with `tenant_id = …`, `status = 'active'`, `embedding is not null`, the
  exclusion list and an `exists (…on_hand - reserved > 0)` stock check. It runs inside a tenant transaction,
  so RLS (ADR 0002) applies on top of the explicit tenant predicate.
- **Against post-filter underfill**, the same transaction sets `hnsw.ef_search = 200` and
  `hnsw.iterative_scan = relaxed_order` with `set_config(…, true)` (transaction-local, like `app.tenant_id`).
  The HNSW index is global across tenants, so a plain scan returns the `ef_search` nearest vectors of _all_
  tenants and the filter may leave far fewer than `limit` rows. Iterative scan (pgvector ≥ 0.8) keeps walking
  the graph until enough rows pass the filter. `relaxed_order` may return rows slightly out of distance order,
  so the method re-sorts by similarity in code.
- **Providers** are pluggable (`packages/personalization/src/embedding-providers.ts`,
  `EMBEDDINGS_PROVIDER=hash|local|openai|voyage`): `hash` is deterministic feature hashing for tests, CI and
  offline demos; `local` is any OpenAI-compatible `/v1/embeddings` server (default `all-MiniLM-L6-v2`, 384
  dimensions); `openai` asks `text-embedding-3-small` for 384 dimensions; `voyage` returns 512 and
  `fitDimensions` truncates and re-normalises. Every provider has a `version` string
  (`provider:model:dimensions`).
- **Writes** happen off the request path: the domain-worker consumes `product.upserted` from
  `catalog.embeddings` in batches of 64 (`apps/domain-worker/src/embeddings.ts`). A product is re-embedded
  only if `embedding_version` differs from the provider version or the SHA-1 of the embedding text
  (`embedding_source_hash`) changed, so stock or price edits do not call the provider. `pnpm reembed`
  (`apps/domain-worker/src/reembed.ts`, flags `--version`, `--all`, `--tenant`) backfills after a model switch.

## Alternatives considered

- **Qdrant** — purpose-built, payload filtering during graph traversal, quantisation. But stock and status
  would have to be mirrored into payloads and kept in sync (another outbox consumer, another failure mode),
  and it is one more stateful service to run, back up and secure per tenant.
- **Pinecone** (managed) — no operations, but a paid external dependency for the demo, network latency on the
  hot path, tenant isolation by namespace only, and the same mirroring problem for stock.
- **Exact kNN without an index** — trivially correct with any filter, fine for a few thousand rows per tenant,
  but cost grows linearly with the catalog. HNSW plus iterative scan gives the same results at this scale.
- **Partial or partitioned index per tenant** — removes cross-tenant noise in the graph, but needs DDL per
  tenant. Kept as the next step for a very large tenant.

## Consequences

- Positive: one query answers "similar, same tenant, active, in stock, not this one"; no sync lag between
  the catalog and the vector index, and no extra service.
- Positive: tenant isolation for vectors is enforced by the same RLS as everything else.
- Positive: switching the embedding model is a config change plus `pnpm reembed`; unchanged texts are skipped.
- Negative: HNSW with filters can still underfill when a tenant is a tiny fraction of the index and the
  iterative scan hits its tuple limit. `ef_search = 200` and the rest of the candidate pipeline
  (`affinity_popular`, `global_popular`) cover the gap, but recall is not guaranteed.
- Negative: vector search competes with OLTP for the same Postgres CPU and memory; the HNSW index must fit
  in RAM to be fast.
- Negative: the column is fixed at `vector(384)`. A larger model means a migration and a full re-embed, and
  truncating Voyage output to 384 dimensions costs some quality (not measured).
- Negative: `hash` embeddings capture shared words, not meaning. Demo quality depends on running `local`.
- Revisit when: the platform passes ~1M vectors, vector queries show up in Postgres CPU profiles, or one
  tenant dominates the index so much that underfill becomes visible in recommendation coverage.

## Verification

- `apps/api/test/integration/personalization.test.ts`, "pgvector tenant-filtered kNN": against real Postgres
  with pgvector, nearest-neighbour search in one tenant's context returns only that tenant's active, in-stock
  products, even though another tenant's products are in the same HNSW index.
- `apps/domain-worker/src/embeddings.ts` metrics: `product_embeddings_total{provider,outcome}` and
  `embedding_request_seconds`; `pnpm reembed` prints how many products were actually re-embedded.
