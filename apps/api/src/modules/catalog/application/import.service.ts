import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from '@cip/observability';
import type { ApiConfig } from '../../../config';
import { ValidationFailedError } from '../../../shared/errors';
import { pgErrorCode } from '../../../shared/pg';
import { currentContext, newContext, runWithContext } from '../../../shared/request-context';
import { CONFIG, LOGGER } from '../../../shared/tokens';
import { JobService } from '../../jobs';
import { buildImport, type ImportedProduct } from '../domain/csv-import';
import { CatalogService } from './catalog.service';

export const IMPORT_JOB = 'product_import';

@Injectable()
export class ProductImportService {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(JobService) private readonly jobs: JobService,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async start(csv: string): Promise<{ jobId: string; status: string }> {
    if (typeof csv !== 'string' || csv.trim().length === 0)
      throw new ValidationFailedError('Send the CSV file as the request body (text/csv)');
    const ctx = currentContext()!;
    const tenantId = ctx.tenantId!;
    const plan = buildImport(csv, this.config.IMPORT_MAX_ROWS);
    const jobId = await this.jobs.create(IMPORT_JOB, plan.rows, 'running');
    const background = newContext({ requestId: ctx.requestId, tenantId, actor: ctx.actor });
    setImmediate(() => {
      void runWithContext(background, () =>
        this.run(tenantId, jobId, plan.products, plan.errors, plan.rows),
      ).catch((error: unknown) => this.logger.warn({ err: error, jobId }, 'import failed'));
    });
    return { jobId, status: 'running' };
  }

  private async run(
    tenantId: string,
    jobId: string,
    products: ImportedProduct[],
    initialErrors: Array<{ row: number; message: string }>,
    totalRows: number,
  ): Promise<void> {
    const errors = [...initialErrors];
    let processed = initialErrors.length;
    let created = 0;
    try {
      const categories = new Map((await this.catalog.listCategories()).data.map((c) => [c.slug, c.id]));
      for (const product of products) {
        try {
          const categoryId = product.category ? categories.get(product.category) : null;
          if (product.category && !categoryId) throw new Error(`unknown category "${product.category}"`);
          await this.catalog.createProduct({
            title: product.title,
            description: product.description,
            brand: product.brand,
            status: product.status,
            categoryId: categoryId ?? null,
            attributes: {},
            tags: product.tags,
            variants: product.variants.map((v) => ({ ...v, attributes: {} })),
          });
          created += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const friendly =
            pgErrorCode(error) === '23505'
              ? 'a variant SKU already exists in the catalog'
              : message.slice(0, 300);
          for (const row of product.rows) errors.push({ row, message: friendly });
        }
        processed += product.rows.length;
        await this.jobs.update(tenantId, jobId, {
          processed,
          failed: errors.length,
          errors: [...errors].sort((a, b) => a.row - b.row),
        });
      }
      await this.jobs.update(tenantId, jobId, {
        status: 'completed',
        processed: totalRows,
        failed: errors.length,
        errors: [...errors].sort((a, b) => a.row - b.row),
        result: { productsCreated: created, rowsFailed: errors.length },
        finishedAt: new Date(),
      });
    } catch (error) {
      await this.jobs.update(tenantId, jobId, {
        status: 'failed',
        result: { error: error instanceof Error ? error.message : String(error) },
        finishedAt: new Date(),
      });
    }
  }
}
