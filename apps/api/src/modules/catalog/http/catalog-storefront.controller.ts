import { Controller, Get, Headers, Inject, Param, Res } from '@nestjs/common';
import {
  categorySchema,
  productSchema,
  storefrontProductListSchema,
  storefrontProductQuerySchema,
  suggestResponseSchema,
} from '@cip/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Storefront } from '../../../shared/http/surface';
import { ZQuery } from '../../../shared/http/zod';
import { CatalogService } from '../application/catalog.service';
import { etagOf, parseIfMatch } from '../domain/catalog';

const suggestQuery = z.object({ q: z.string().max(100).default('') });

@Controller('v1/storefront')
export class CatalogStorefrontController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('catalog/categories')
  @Storefront()
  @Doc({
    summary: 'Categories of the store',
    tags: ['storefront'],
    response: z.object({ data: z.array(categorySchema) }),
  })
  categories() {
    return this.catalog.listCategories();
  }

  @Get('catalog/products')
  @Storefront()
  @Doc({
    summary: 'Active products with filters, facets and cursor pagination',
    tags: ['storefront'],
    query: storefrontProductQuerySchema,
    response: storefrontProductListSchema,
  })
  products(@ZQuery(storefrontProductQuerySchema) query: z.infer<typeof storefrontProductQuerySchema>) {
    return this.catalog.storefrontList(query);
  }

  @Get('catalog/products/:slug')
  @Storefront()
  @Doc({
    summary: 'Product detail page data (ETag / If-None-Match)',
    tags: ['storefront'],
    response: productSchema,
  })
  async product(
    @Param('slug') slug: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const product = await this.catalog.storefrontProduct(slug);
    res.setHeader('ETag', etagOf(product.version));
    res.setHeader('Cache-Control', 'no-cache');
    if (parseIfMatch(ifNoneMatch) === product.version) {
      res.status(304);
      return undefined;
    }
    return product;
  }

  @Get('search/suggest')
  @Storefront()
  @Doc({
    summary: 'Typeahead suggestions (trigram)',
    tags: ['storefront'],
    query: suggestQuery,
    response: suggestResponseSchema,
  })
  suggest(@ZQuery(suggestQuery) query: z.infer<typeof suggestQuery>) {
    return this.catalog.suggest(query.q);
  }
}
