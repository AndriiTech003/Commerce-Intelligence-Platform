import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  importAcceptedSchema,
  categoryCreateSchema,
  categorySchema,
  categoryUpdateSchema,
  imageReorderSchema,
  imageUploadRequestSchema,
  imageUploadResponseSchema,
  pageSchema,
  productCreateSchema,
  productListItemSchema,
  productListQuerySchema,
  productSchema,
  productUpdateSchema,
  uuid,
} from '@cip/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam, ZQuery } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { CatalogService } from '../application/catalog.service';
import { ProductImportService } from '../application/import.service';
import { etagOf, parseIfMatch } from '../domain/catalog';

@Controller('v1/admin')
export class CatalogAdminController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ProductImportService) private readonly importer: ProductImportService,
  ) {}

  @Get('categories')
  @Admin('catalog:read')
  @Doc({
    summary: 'Category tree (flat, ordered by ltree path)',
    tags: ['catalog'],
    response: z.object({ data: z.array(categorySchema) }),
  })
  categories() {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @Admin('catalog:write')
  @Audit('category.created', 'category')
  @Doc({
    summary: 'Create a category (max depth 3)',
    tags: ['catalog'],
    body: categoryCreateSchema,
    response: categorySchema,
    status: 201,
  })
  async createCategory(@ZBody(categoryCreateSchema) body: z.infer<typeof categoryCreateSchema>) {
    const category = await this.catalog.createCategory(body);
    currentContext()?.audit.push({
      entityId: category.id,
      before: null,
      after: { name: category.name, slug: category.slug, path: category.path },
    });
    return category;
  }

  @Patch('categories/:id')
  @Admin('catalog:write')
  @Audit('category.updated', 'category')
  @Doc({
    summary: 'Rename a category; slug changes move the subtree',
    tags: ['catalog'],
    body: categoryUpdateSchema,
    response: categorySchema,
  })
  async updateCategory(
    @ZParam('id', uuid) id: string,
    @ZBody(categoryUpdateSchema) body: z.infer<typeof categoryUpdateSchema>,
  ) {
    const { before, after } = await this.catalog.updateCategory(id, body);
    currentContext()?.audit.push({
      entityId: id,
      before: { name: before.name, slug: before.slug, path: before.path },
      after: { name: after.name, slug: after.slug, path: after.path },
    });
    return after;
  }

  @Delete('categories/:id')
  @Admin('catalog:write')
  @Audit('category.deleted', 'category')
  @HttpCode(204)
  @Doc({ summary: 'Delete an empty category', tags: ['catalog'], status: 204 })
  async deleteCategory(@ZParam('id', uuid) id: string) {
    const removed = await this.catalog.deleteCategory(id);
    currentContext()?.audit.push({
      entityId: id,
      before: { name: removed.name, slug: removed.slug },
      after: null,
    });
  }

  @Get('products')
  @Admin('catalog:read')
  @Doc({
    summary: 'Products with search (FTS + trigram), filters and cursor pagination',
    tags: ['catalog'],
    query: productListQuerySchema,
    response: pageSchema(productListItemSchema),
  })
  products(@ZQuery(productListQuerySchema) query: z.infer<typeof productListQuerySchema>) {
    return this.catalog.listProducts(query);
  }

  @Post('products')
  @Admin('catalog:write')
  @Audit('product.created', 'product')
  @Doc({
    summary: 'Create a product with variants and stock',
    tags: ['catalog'],
    body: productCreateSchema,
    response: productSchema,
    status: 201,
  })
  async create(
    @ZBody(productCreateSchema) body: z.infer<typeof productCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const product = await this.catalog.createProduct(body);
    res.setHeader('ETag', etagOf(product.version));
    currentContext()?.audit.push({
      entityId: product.id,
      before: null,
      after: this.catalog.auditShape(product),
    });
    return product;
  }

  @Post('products/import')
  @Admin('catalog:write')
  @Audit('product.import_started', 'job')
  @HttpCode(202)
  @Doc({
    summary:
      'Bulk CSV import (text/csv body: handle,title,description,brand,status,category,tags,sku,variant_title,price,compare_at_price,stock) → job id',
    tags: ['catalog'],
    response: importAcceptedSchema,
    status: 202,
  })
  async importProducts(@Body() body: unknown) {
    const result = await this.importer.start(typeof body === 'string' ? body : '');
    currentContext()?.audit.push({ entityId: result.jobId, before: null, after: { ...result } });
    return result;
  }

  @Get('products/:id')
  @Admin('catalog:read')
  @Doc({
    summary: 'Product with variants, stock and images (ETag = version)',
    tags: ['catalog'],
    response: productSchema,
  })
  async get(@ZParam('id', uuid) id: string, @Res({ passthrough: true }) res: Response) {
    const product = await this.catalog.getProduct(id);
    res.setHeader('ETag', etagOf(product.version));
    return product;
  }

  @Patch('products/:id')
  @Admin('catalog:write')
  @Audit('product.updated', 'product')
  @Doc({
    summary: 'Update a product; requires If-Match with the current version (412 on conflict)',
    tags: ['catalog'],
    body: productUpdateSchema,
    response: productSchema,
    headers: [{ name: 'If-Match', required: true, description: 'Product version from ETag' }],
  })
  async update(
    @ZParam('id', uuid) id: string,
    @ZBody(productUpdateSchema) body: z.infer<typeof productUpdateSchema>,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { before, after } = await this.catalog.updateProduct(id, body, parseIfMatch(ifMatch));
    res.setHeader('ETag', etagOf(after.version));
    currentContext()?.audit.push({
      entityId: id,
      before: this.catalog.auditShape(before),
      after: this.catalog.auditShape(after),
    });
    return after;
  }

  @Delete('products/:id')
  @Admin('catalog:write')
  @Audit('product.deleted', 'product')
  @HttpCode(204)
  @Doc({ summary: 'Delete a product', tags: ['catalog'], status: 204 })
  async remove(@ZParam('id', uuid) id: string) {
    const removed = await this.catalog.deleteProduct(id);
    currentContext()?.audit.push({ entityId: id, before: this.catalog.auditShape(removed), after: null });
  }

  @Post('products/:id/images')
  @Admin('catalog:write')
  @Audit('product.image_added', 'product')
  @Doc({
    summary: 'Register an image and get a presigned PUT URL for MinIO/S3',
    tags: ['catalog'],
    body: imageUploadRequestSchema,
    response: imageUploadResponseSchema,
    status: 201,
  })
  async upload(
    @ZParam('id', uuid) id: string,
    @ZBody(imageUploadRequestSchema) body: z.infer<typeof imageUploadRequestSchema>,
  ) {
    const result = await this.catalog.requestImageUpload(id, body);
    currentContext()?.audit.push({ entityId: id, before: null, after: { image: result.image.storageKey } });
    return result;
  }

  @Delete('products/:id/images/:imageId')
  @Admin('catalog:write')
  @Audit('product.image_removed', 'product')
  @HttpCode(204)
  @Doc({ summary: 'Remove an image', tags: ['catalog'], status: 204 })
  async deleteImage(@ZParam('id', uuid) id: string, @ZParam('imageId', uuid) imageId: string) {
    const removed = await this.catalog.deleteImage(id, imageId);
    currentContext()?.audit.push({ entityId: id, before: { image: removed.storageKey }, after: null });
  }

  @Put('products/:id/images/order')
  @Admin('catalog:write')
  @Audit('product.images_reordered', 'product')
  @Doc({ summary: 'Reorder images', tags: ['catalog'], body: imageReorderSchema, response: productSchema })
  reorder(
    @ZParam('id', uuid) id: string,
    @ZBody(imageReorderSchema) body: z.infer<typeof imageReorderSchema>,
  ) {
    return this.catalog.reorderImages(id, body.imageIds);
  }
}
