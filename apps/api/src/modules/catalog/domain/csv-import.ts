import { z } from 'zod';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export const IMPORT_COLUMNS = [
  'handle',
  'title',
  'description',
  'brand',
  'status',
  'category',
  'tags',
  'sku',
  'variant_title',
  'price',
  'compare_at_price',
  'stock',
] as const;

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a decimal amount like 129.00')
  .transform((v) => Math.round(Number(v) * 100));

export const importRowSchema = z.object({
  handle: z.string().trim().max(120).optional(),
  title: z.string().trim().min(1, 'title is required').max(200),
  description: z.string().max(20000).default(''),
  brand: z.string().trim().max(120).optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  category: z.string().trim().max(80).optional(),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(/[;|]/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 30)
        : [],
    ),
  sku: z.string().trim().min(1, 'sku is required').max(64),
  variant_title: z.string().trim().max(120).default('Default'),
  price: money,
  compare_at_price: money.optional(),
  stock: z.string().trim().regex(/^\d+$/, 'stock must be a whole number').transform(Number).default(0),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export interface ImportedProduct {
  key: string;
  rows: number[];
  title: string;
  description: string;
  brand: string | null;
  status: 'draft' | 'active' | 'archived';
  category: string | null;
  tags: string[];
  variants: Array<{
    sku: string;
    title: string;
    priceCents: number;
    compareAtCents: number | null;
    onHand: number;
  }>;
}

export function buildImport(text: string, maxRows: number) {
  const table = parseCsv(text);
  const errors: Array<{ row: number; message: string }> = [];
  if (table.length === 0) return { products: [], errors: [{ row: 1, message: 'file is empty' }], rows: 0 };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const missing = ['title', 'sku', 'price'].filter((c) => !header.includes(c));
  if (missing.length > 0)
    return {
      products: [],
      errors: [{ row: 1, message: `missing required columns: ${missing.join(', ')}` }],
      rows: 0,
    };
  const body = table.slice(1);
  if (body.length > maxRows)
    return {
      products: [],
      errors: [{ row: 1, message: `too many rows: ${body.length} > ${maxRows}` }],
      rows: body.length,
    };
  const products = new Map<string, ImportedProduct>();
  const skus = new Set<string>();
  body.forEach((cells, index) => {
    const rowNumber = index + 2;
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      const value = cells[i];
      if (value !== undefined && value.trim() !== '') record[name] = value;
    });
    const parsed = importRowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        message: parsed.error.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`).join('; '),
      });
      return;
    }
    const row = parsed.data;
    if (skus.has(row.sku.toLowerCase())) {
      errors.push({ row: rowNumber, message: `duplicate sku ${row.sku} in file` });
      return;
    }
    skus.add(row.sku.toLowerCase());
    const key = (row.handle ?? row.title).toLowerCase();
    const product =
      products.get(key) ??
      ({
        key,
        rows: [],
        title: row.title,
        description: row.description,
        brand: row.brand ?? null,
        status: row.status,
        category: row.category ?? null,
        tags: row.tags,
        variants: [],
      } satisfies ImportedProduct);
    product.rows.push(rowNumber);
    product.variants.push({
      sku: row.sku,
      title: row.variant_title,
      priceCents: row.price,
      compareAtCents: row.compare_at_price ?? null,
      onHand: row.stock,
    });
    products.set(key, product);
  });
  return { products: [...products.values()], errors, rows: body.length };
}
