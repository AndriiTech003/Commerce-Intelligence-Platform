import Link from 'next/link';
import { ProductImage, formatMoney } from '@cip/ui';
import type { ProductSummary } from '@/lib/types';

export function ProductCard({
  product,
  testId = 'product-card',
  onClick,
  attributes,
}: {
  product: ProductSummary;
  testId?: string;
  onClick?: () => void;
  attributes?: Record<`data-${string}`, string | number>;
}) {
  const onSale =
    product.compareAtCents !== null &&
    product.priceMinCents !== null &&
    product.compareAtCents > product.priceMinCents;
  return (
    <Link
      href={`/p/${product.slug}`}
      {...attributes}
      data-testid={testId}
      data-product-id={product.id}
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="relative aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
        <ProductImage
          src={product.imageUrl}
          alt={product.title}
          className="transition group-hover:scale-[1.03]"
        />
        {!product.available ? (
          <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-xs font-medium text-white">
            Sold out
          </span>
        ) : onSale ? (
          <span className="absolute left-2 top-2 rounded-full bg-[var(--brand)] px-2 py-0.5 text-xs font-medium text-white">
            Sale
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brand ? (
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {product.brand}
          </span>
        ) : null}
        <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">
          {product.title}
        </span>
        <span className="mt-auto flex items-baseline gap-2 pt-1">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {formatMoney(product.priceMinCents, product.currency)}
          </span>
          {onSale ? (
            <span className="text-xs text-slate-500 dark:text-slate-400 line-through">
              {formatMoney(product.compareAtCents, product.currency)}
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}
