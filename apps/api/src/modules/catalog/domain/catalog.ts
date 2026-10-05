import { DomainError } from '../../../shared/errors';

export const MAX_CATEGORY_DEPTH = 3;

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'item'
  );
}

export function ltreeLabel(slug: string): string {
  return slug.replace(/-/g, '_');
}

export function childPath(parentPath: string | null, slug: string): string {
  return parentPath ? `${parentPath}.${ltreeLabel(slug)}` : ltreeLabel(slug);
}

export function depthOf(path: string): number {
  return path.split('.').length;
}

export function priceMin(variants: Array<{ priceCents: number }>): number | null {
  if (variants.length === 0) return null;
  return Math.min(...variants.map((v) => v.priceCents));
}

export function versionOf(updatedAt: Date): string {
  return String(updatedAt.getTime());
}

export function etagOf(version: string): string {
  return `"${version}"`;
}

export function parseIfMatch(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^(?:W\/)?"?([^"]+)"?$/.exec(header.trim());
  return match ? match[1]! : null;
}

export class CategoryTooDeepError extends DomainError {
  constructor() {
    super('VALIDATION_FAILED', 400, `Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep`);
  }
}

export class CategoryNotEmptyError extends DomainError {
  constructor() {
    super('CONFLICT', 409, 'Category has subcategories; delete or move them first');
  }
}

export class ProductVersionConflictError extends DomainError {
  constructor(current: string) {
    super('PRECONDITION_FAILED', 412, 'Product was changed by someone else', [{ currentVersion: current }]);
  }
}

export class DuplicateSkuError extends DomainError {
  constructor(sku: string) {
    super('CONFLICT', 409, `SKU ${sku} is used more than once`, [{ field: 'variants', sku }]);
  }
}

export function assertUniqueSkus(variants: Array<{ sku: string }>): void {
  const seen = new Set<string>();
  for (const v of variants) {
    const key = v.sku.toLowerCase();
    if (seen.has(key)) throw new DuplicateSkuError(v.sku);
    seen.add(key);
  }
}

export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
