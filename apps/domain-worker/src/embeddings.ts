import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { parseDomainEvent } from '@cip/contracts';
import { PoisonMessageError, type BatchItem } from '@cip/messaging';
import { counter, histogram, type Logger } from '@cip/observability';
import { embeddingText, vectorLiteral, type EmbeddingProvider } from '@cip/personalization';

const embedded = counter('product_embeddings_total', 'Product embeddings computed', ['provider', 'outcome']);
const embedSeconds = histogram('embedding_request_seconds', 'Embedding provider latency', ['provider']);

export const EMBEDDING_BATCH = 64;

export function parseProductUpserted(raw: unknown): { tenantId: string; productId: string } {
  const parsed = parseDomainEvent(raw);
  if (!parsed.ok) throw new PoisonMessageError(parsed.reason);
  if (parsed.event.event_type !== 'product.upserted')
    throw new PoisonMessageError('expected product.upserted');
  return { tenantId: parsed.event.tenant_id, productId: parsed.event.properties.product_id };
}

interface ProductTextRow {
  id: string;
  title: string;
  brand: string | null;
  description: string;
  attributes: Record<string, unknown>;
  tags: string[];
  category_path: string | null;
  embedding_version: string | null;
  embedding_source_hash: string | null;
}

export function sourceHash(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export class ProductEmbedder {
  constructor(
    private readonly pool: Pool,
    private readonly provider: EmbeddingProvider,
    private readonly logger: Logger,
  ) {}

  get version(): string {
    return this.provider.version;
  }

  async embedProducts(productIds: string[], options: { force?: boolean } = {}): Promise<number> {
    if (productIds.length === 0) return 0;
    const { rows } = await this.pool.query<ProductTextRow>(
      `select p.id, p.title, p.brand, p.description, p.attributes, p.tags, c.path::text as category_path,
              p.embedding_version, p.embedding_source_hash
         from products p left join categories c on c.id = p.category_id
        where p.id = any($1::uuid[])`,
      [productIds],
    );
    const work = rows
      .map((row) => {
        const text = embeddingText({
          title: row.title,
          brand: row.brand,
          categoryPath: row.category_path,
          attributes: row.attributes,
          tags: row.tags,
          description: row.description,
        });
        return { row, text, hash: sourceHash(text) };
      })
      .filter(
        (w) =>
          options.force ||
          w.row.embedding_version !== this.provider.version ||
          w.row.embedding_source_hash !== w.hash,
      );
    let done = 0;
    for (let offset = 0; offset < work.length; offset += EMBEDDING_BATCH) {
      const chunk = work.slice(offset, offset + EMBEDDING_BATCH);
      const timer = embedSeconds.startTimer({ provider: this.provider.name });
      let vectors: number[][];
      try {
        vectors = await this.provider.embed(
          chunk.map((c) => c.text),
          'document',
        );
      } catch (error) {
        embedded.inc({ provider: this.provider.name, outcome: 'error' }, chunk.length);
        throw error;
      } finally {
        timer();
      }
      const ids = chunk.map((c) => c.row.id);
      const literals = vectors.map((v) => vectorLiteral(v));
      const hashes = chunk.map((c) => c.hash);
      await this.pool.query(
        `update products p set embedding = v.embedding::vector, embedding_version = $4, embedding_source_hash = v.hash
           from unnest($1::uuid[], $2::text[], $3::text[]) as v(id, embedding, hash)
          where p.id = v.id`,
        [ids, literals, hashes, this.provider.version],
      );
      embedded.inc({ provider: this.provider.name, outcome: 'ok' }, chunk.length);
      done += chunk.length;
    }
    if (done > 0) this.logger.debug({ count: done, version: this.provider.version }, 'products embedded');
    return done;
  }

  async handleBatch(items: BatchItem<{ tenantId: string; productId: string }>[]): Promise<void> {
    const ids = [...new Set(items.map((i) => i.data.productId))];
    await this.embedProducts(ids);
  }

  async reembed(options: {
    all?: boolean;
    tenantId?: string;
    onProgress?: (done: number, total: number) => void;
  }): Promise<{ total: number; embedded: number }> {
    const where: string[] = ['true'];
    const params: unknown[] = [];
    if (!options.all) {
      params.push(this.provider.version);
      where.push(`(embedding_version is distinct from $1 or embedding is null)`);
    }
    if (options.tenantId) {
      params.push(options.tenantId);
      where.push(`tenant_id = $${params.length}::uuid`);
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from products where ${where.join(' and ')} order by id`,
      params,
    );
    let count = 0;
    for (let offset = 0; offset < rows.length; offset += EMBEDDING_BATCH) {
      count += await this.embedProducts(
        rows.slice(offset, offset + EMBEDDING_BATCH).map((r) => r.id),
        { force: options.all ?? false },
      );
      options.onProgress?.(Math.min(offset + EMBEDDING_BATCH, rows.length), rows.length);
    }
    return { total: rows.length, embedded: count };
  }
}
