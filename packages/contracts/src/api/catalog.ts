import { z } from 'zod';
import { uuid } from '../events/envelope';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);

const productSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case')
  .max(120);

export const categorySchema = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  name: z.string(),
  slug: z.string(),
  path: z.string(),
  depth: z.number().int(),
  productCount: z.number().int().optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: productSlug,
  parentId: uuid.nullish(),
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: productSlug.optional(),
});

export const variantInputSchema = z.object({
  id: uuid.optional(),
  sku: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(0),
  compareAtCents: z.number().int().min(0).nullish(),
  attributes: z.record(z.string(), z.string()).default({}),
  onHand: z.number().int().min(0).default(0),
});

export const productCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: productSlug.optional(),
  description: z.string().max(20000).default(''),
  brand: z.string().trim().max(120).nullish(),
  status: productStatusSchema.default('draft'),
  categoryId: uuid.nullish(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  variants: z.array(variantInputSchema).min(1).max(100),
});

export const productUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: productSlug.optional(),
  description: z.string().max(20000).optional(),
  brand: z.string().trim().max(120).nullish(),
  status: productStatusSchema.optional(),
  categoryId: uuid.nullish(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  variants: z.array(variantInputSchema).min(1).max(100).optional(),
});

export const productImageSchema = z.object({
  id: uuid,
  url: z.string(),
  storageKey: z.string(),
  position: z.number().int(),
  alt: z.string().nullable(),
});

export const variantSchema = z.object({
  id: uuid,
  sku: z.string(),
  title: z.string(),
  priceCents: z.number().int(),
  compareAtCents: z.number().int().nullable(),
  currency: z.string(),
  attributes: z.record(z.string(), z.string()),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
});

export const productSchema = z.object({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  brand: z.string().nullable(),
  status: productStatusSchema,
  categoryId: uuid.nullable(),
  categoryPath: z.string().nullable(),
  categoryName: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()),
  priceMinCents: z.number().int().nullable(),
  currency: z.string(),
  images: z.array(productImageSchema),
  variants: z.array(variantSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.string(),
});

export const productListItemSchema = z.object({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  brand: z.string().nullable(),
  status: productStatusSchema,
  categoryId: uuid.nullable(),
  categoryName: z.string().nullable(),
  priceMinCents: z.number().int().nullable(),
  currency: z.string(),
  totalAvailable: z.number().int(),
  variantCount: z.number().int(),
  imageUrl: z.string().nullable(),
  updatedAt: z.string(),
});

export const productListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: productStatusSchema.optional(),
  categoryId: uuid.optional(),
  lowStock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(['-updated_at', 'updated_at', 'title', '-title', 'price', '-price']).default('-updated_at'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const imageUploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']),
  alt: z.string().max(200).optional(),
});

export const imageUploadResponseSchema = z.object({
  image: productImageSchema,
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresIn: z.number().int(),
});

export const imageReorderSchema = z.object({ imageIds: z.array(uuid).min(1).max(50) });

export const inventoryItemSchema = z.object({
  variantId: uuid,
  productId: uuid,
  productTitle: z.string(),
  sku: z.string(),
  variantTitle: z.string(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  lowStock: z.boolean(),
});

export const inventoryQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const inventoryAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, 'delta must not be zero'),
  reason: z.string().trim().min(1).max(200),
});

export const inventoryMovementSchema = z.object({
  id: uuid,
  delta: z.number().int(),
  reason: z.string(),
  referenceId: z.string().nullable(),
  actorId: z.string().nullable(),
  createdAt: z.string(),
});

export const storefrontProductQuerySchema = z.object({
  category: z.string().max(200).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).default('newest'),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  brand: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  cursor: z.string().optional(),
});

export const storefrontProductCardSchema = z.object({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  brand: z.string().nullable(),
  priceMinCents: z.number().int().nullable(),
  compareAtCents: z.number().int().nullable(),
  currency: z.string(),
  categoryPath: z.string().nullable(),
  imageUrl: z.string().nullable(),
  available: z.boolean(),
});

export const storefrontProductListSchema = z.object({
  data: z.array(storefrontProductCardSchema),
  nextCursor: z.string().nullable(),
  facets: z.object({
    brands: z.array(z.object({ value: z.string(), count: z.number().int() })),
    priceRange: z.object({ min: z.number().int().nullable(), max: z.number().int().nullable() }),
  }),
});

export const suggestResponseSchema = z.object({
  query: z.string(),
  products: z.array(z.object({ id: uuid, title: z.string(), slug: z.string(), score: z.number() })),
});
