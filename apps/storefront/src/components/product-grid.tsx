import { Skeleton } from '@cip/ui';
import type { ProductSummary } from '@/lib/types';
import { ProductCard } from './product-card';

export const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4';

export function ProductGrid({ products }: { products: ProductSummary[] }) {
  return (
    <div className={GRID} data-testid="product-grid">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
      aria-hidden="true"
    >
      <Skeleton className="aspect-square rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/4" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={GRID} role="status" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
