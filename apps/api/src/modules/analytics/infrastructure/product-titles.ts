import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { creatives, products } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { ProductTitles } from '../application/ports';

@Injectable()
export class DrizzleProductTitles implements ProductTitles {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async titles(productIds: string[]) {
    const map = new Map<string, string>();
    if (productIds.length === 0) return map;
    const rows = await this.db
      .tx()
      .select({ id: products.id, title: products.title })
      .from(products)
      .where(inArray(products.id, productIds));
    for (const r of rows) map.set(r.id, r.title);
    return map;
  }

  async creativeHeadlines(creativeIds: string[]) {
    const map = new Map<string, string>();
    if (creativeIds.length === 0) return map;
    const rows = await this.db
      .tx()
      .select({ id: creatives.id, headline: creatives.headline })
      .from(creatives)
      .where(inArray(creatives.id, creativeIds));
    for (const r of rows) map.set(r.id, r.headline);
    return map;
  }
}
