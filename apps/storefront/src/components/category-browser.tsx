'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, ErrorNote, Input, Select, Spinner, formatMoney } from '@cip/ui';
import { unwrap } from '@cip/api-client';
import { api } from '@/lib/browser-api';
import { SORTS, SORT_LABELS, buildFilterHref, isSort, type CatalogQuery } from '@/lib/catalog-query';
import { centsToInput, priceFilterFromInputs } from '@/lib/price-filter';
import type { ProductList } from '@/lib/types';
import { GRID, ProductGridSkeleton } from './product-grid';
import { ProductCard } from './product-card';

export interface CategoryBrowserProps {
  basePath: string;
  initial: ProductList;
  query: CatalogQuery;
  params: Record<string, string>;
  currency: string;
}

export function CategoryBrowser({ basePath, initial, query, params, currency }: CategoryBrowserProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [products, setProducts] = useState(initial.data);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [minInput, setMinInput] = useState(centsToInput(query.priceMin ?? null));
  const [maxInput, setMaxInput] = useState(centsToInput(query.priceMax ?? null));
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const navigate = (changes: Record<string, string | null>) => {
    startTransition(() => {
      router.push(buildFilterHref(basePath, params, changes), { scroll: false });
    });
  };

  const loadMore = useCallback(async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = unwrap(
        await api().GET('/v1/storefront/catalog/products', { params: { query: { ...query, cursor } } }),
      );
      setProducts((current) => {
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...next.data.filter((p) => !seen.has(p.id))];
      });
      setCursor(next.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, query]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore, error]);

  const activeBrand = params.brand ?? null;
  const range = initial.facets.priceRange;
  const hasFilters = Boolean(params.brand || params.price);

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside aria-label="Filters" className="space-y-6" data-testid="facets">
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Brand
          </h2>
          {initial.facets.brands.length ? (
            <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
              {initial.facets.brands.map((brand) => {
                const selected = activeBrand === brand.value;
                return (
                  <li key={brand.value}>
                    <button
                      type="button"
                      data-testid="facet-brand"
                      aria-pressed={selected}
                      onClick={() => navigate({ brand: selected ? null : brand.value })}
                      className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${
                        selected
                          ? 'bg-[var(--brand)] text-white'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{brand.value}</span>
                      <span className={selected ? 'text-white' : 'text-slate-500 dark:text-slate-400'}>
                        {brand.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">No brands</p>
          )}
        </div>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ price: priceFilterFromInputs(minInput, maxInput) });
          }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Price
          </h2>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="price-min">
              Minimum price
            </label>
            <Input
              id="price-min"
              name="priceMin"
              inputMode="decimal"
              placeholder={range.min !== null ? String(Math.floor(range.min / 100)) : 'Min'}
              value={minInput}
              onChange={(event) => setMinInput(event.target.value)}
            />
            <span aria-hidden="true" className="text-slate-500 dark:text-slate-400">
              –
            </span>
            <label className="sr-only" htmlFor="price-max">
              Maximum price
            </label>
            <Input
              id="price-max"
              name="priceMax"
              inputMode="decimal"
              placeholder={range.max !== null ? String(Math.ceil(range.max / 100)) : 'Max'}
              value={maxInput}
              onChange={(event) => setMaxInput(event.target.value)}
            />
          </div>
          {range.min !== null && range.max !== null ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatMoney(range.min, currency)} – {formatMoney(range.max, currency)}
            </p>
          ) : null}
          <Button type="submit" size="sm" variant="secondary" data-testid="price-apply" className="w-full">
            Apply
          </Button>
        </form>
        {hasFilters ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMinInput('');
              setMaxInput('');
              navigate({ brand: null, price: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </aside>

      <section aria-label="Products" aria-busy={pending || loading}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="results-count">
            {products.length}
            {cursor ? '+' : ''} products
          </p>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Sort</span>
            <Select
              data-testid="sort-select"
              className="w-auto"
              value={query.sort ?? 'relevance'}
              onChange={(event) => {
                const value = event.target.value;
                navigate({ sort: isSort(value) && value !== 'relevance' ? value : null });
              }}
            >
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {pending ? (
          <ProductGridSkeleton />
        ) : products.length ? (
          <div className={GRID} data-testid="product-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No products match"
            description="Try removing a filter or widening the price range."
          />
        )}
        <div ref={sentinel} aria-hidden="true" className="h-px" />
        {loading ? (
          <div className="mt-6 flex justify-center">
            <Spinner />
          </div>
        ) : null}
        {error ? (
          <div className="mt-6 space-y-2">
            <ErrorNote error={error} />
            <Button size="sm" variant="secondary" onClick={() => void loadMore()}>
              Retry
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
