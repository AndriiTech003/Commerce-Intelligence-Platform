import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import type { DemoCatalogProvisioner } from '../../identity';
import { InventoryService } from '../../inventory';
import { childPath } from '../domain/catalog';
import { generateDemoCatalog, type DemoCatalog } from '../domain/demo-catalog';
import { priceMin } from '../domain/catalog';
import { CATALOG_REPOSITORY, type CatalogRepository } from './ports';

@Injectable()
export class DemoCatalogService implements DemoCatalogProvisioner {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly repo: CatalogRepository,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  async provision(tenantId: string, currency: string, size: number): Promise<number> {
    const catalog = generateDemoCatalog(
      'default',
      size,
      tenantId.split('').reduce((a, c) => a + c.charCodeAt(0), 0),
      'DEMO',
    );
    return this.load(catalog, currency);
  }

  async load(catalog: DemoCatalog, currency: string, ids?: () => string): Promise<number> {
    const nextId = ids ?? uuidv7;
    const categoryIds = new Map<string, { id: string; path: string }>();
    for (const category of catalog.categories) {
      const parent = category.parent ? categoryIds.get(category.parent) : undefined;
      const row = {
        id: nextId(),
        parentId: parent?.id ?? null,
        name: category.name,
        slug: category.slug,
        path: childPath(parent?.path ?? null, category.slug),
      };
      await this.repo.insertCategory(row);
      categoryIds.set(category.slug, { id: row.id, path: row.path });
    }
    for (const product of catalog.products) {
      const id = nextId();
      await this.repo.insertProduct(id, {
        title: product.title,
        slug: product.slug,
        description: product.description,
        brand: product.brand,
        status: product.status,
        categoryId: categoryIds.get(product.categorySlug)?.id ?? null,
        attributes: product.attributes,
        tags: product.tags,
        priceMinCents: priceMin(product.variants),
      });
      for (const variant of product.variants) {
        const variantId = nextId();
        await this.repo.insertVariant(id, {
          id: variantId,
          sku: variant.sku,
          title: variant.title,
          priceCents: variant.priceCents,
          compareAtCents: variant.compareAtCents,
          currency,
          attributes: variant.attributes,
        });
        await this.inventory.initialize(variantId, variant.onHand);
      }
    }
    return catalog.products.length;
  }
}
