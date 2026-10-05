'use client';

import {
  Badge,
  Card,
  CardTitle,
  ErrorNote,
  Field,
  formatMoney,
  formatNumber,
  Input,
  ProductImage,
  Select,
  Skeleton,
  Spinner,
} from '@cip/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';
import type { ProductSelector } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced';

export const PLACEMENT_INFO = {
  home_hero: { label: 'Home hero', help: 'Full-width banner at the top of the home page, 4 products' },
  category_banner: { label: 'Category banner', help: 'Banner above category listings, 3 products' },
  pdp_sidebar: { label: 'Product page sidebar', help: 'Compact block next to the product, 2 products' },
  cart_upsell: { label: 'Cart upsell', help: 'Cross-sell block in the cart, 3 products' },
} as const;

export interface SelectorDraft {
  categoryPath: string;
  brands: string[];
  priceMin: string;
  priceMax: string;
  q: string;
}

export const EMPTY_SELECTOR: SelectorDraft = {
  categoryPath: '',
  brands: [],
  priceMin: '',
  priceMax: '',
  q: '',
};

function dollarsToCents(value: string): number | undefined {
  const n = Number(value.replace(',', '.'));
  if (value.trim() === '' || !Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

export function toSelector(draft: SelectorDraft): ProductSelector {
  const selector: ProductSelector = {};
  if (draft.categoryPath) selector.categoryPath = draft.categoryPath;
  if (draft.brands.length > 0) selector.brands = draft.brands;
  const min = dollarsToCents(draft.priceMin);
  const max = dollarsToCents(draft.priceMax);
  if (min !== undefined) selector.priceMin = min;
  if (max !== undefined) selector.priceMax = max;
  if (draft.q.trim()) selector.q = draft.q.trim();
  return selector;
}

export function describeSelector(selector: ProductSelector): string {
  const parts: string[] = [];
  if (selector.categoryPath) parts.push(`category ${selector.categoryPath}`);
  if (selector.brands?.length) parts.push(`brands ${selector.brands.join(', ')}`);
  if (selector.priceMin !== undefined) parts.push(`from ${formatMoney(selector.priceMin)}`);
  if (selector.priceMax !== undefined) parts.push(`up to ${formatMoney(selector.priceMax)}`);
  if (selector.q) parts.push(`“${selector.q}”`);
  if (selector.productIds?.length) parts.push(`${selector.productIds.length} pinned products`);
  return parts.length > 0 ? parts.join(' · ') : 'all active products';
}

export function usePreviewProducts(selector: ProductSelector | null, limit = 8) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: queryKeys.campaigns.previewProducts(tenantId, selector ?? {}, limit),
    enabled: selector !== null,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(
        await api.POST('/v1/admin/campaigns/preview-products', {
          body: { productSelector: selector ?? {}, limit },
        }),
      ),
  });
}

export function ProductSelectorForm({
  value,
  onChange,
}: {
  value: SelectorDraft;
  onChange: (next: SelectorDraft) => void;
}) {
  const tenantId = useTenantId();
  const categories = useQuery({
    queryKey: queryKeys.categories(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/categories')),
  });
  const features = useQuery({
    queryKey: queryKeys.segments.features(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/segments/features')),
    staleTime: 300_000,
  });
  const selectorJson = useDebouncedValue(JSON.stringify(toSelector(value)), 400);
  const selector = useMemo(() => JSON.parse(selectorJson) as ProductSelector, [selectorJson]);
  const preview = usePreviewProducts(selector, 8);
  const brands = features.data?.brands ?? [];
  const sortedCategories = [...(categories.data?.data ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  const toggleBrand = (brand: string) =>
    onChange({
      ...value,
      brands: value.brands.includes(brand)
        ? value.brands.filter((b) => b !== brand)
        : [...value.brands, brand],
    });
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-3">
        <Field label="Category" htmlFor="selector-category">
          <Select
            id="selector-category"
            value={value.categoryPath}
            onChange={(e) => onChange({ ...value, categoryPath: e.target.value })}
            data-testid="selector-category"
          >
            <option value="">Any category</option>
            {sortedCategories.map((c) => (
              <option key={c.id} value={c.path}>
                {'· '.repeat(Math.max(0, c.depth - 1))}
                {c.name} ({c.path})
              </option>
            ))}
          </Select>
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Brands</legend>
          {brands.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No brands found in the catalog.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {brands.map((brand) => (
                <label
                  key={brand}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-300 px-2.5 py-1 text-xs has-[:checked]:border-[var(--brand,#2563eb)] has-[:checked]:bg-blue-50 dark:border-slate-700 dark:has-[:checked]:bg-blue-950"
                >
                  <input
                    type="checkbox"
                    checked={value.brands.includes(brand)}
                    onChange={() => toggleBrand(brand)}
                    data-testid={`selector-brand-${brand}`}
                  />
                  {brand}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min price" htmlFor="selector-min">
            <Input
              id="selector-min"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={value.priceMin}
              onChange={(e) => onChange({ ...value, priceMin: e.target.value })}
            />
          </Field>
          <Field label="Max price" htmlFor="selector-max">
            <Input
              id="selector-max"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="any"
              value={value.priceMax}
              onChange={(e) => onChange({ ...value, priceMax: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Title contains" htmlFor="selector-q">
          <Input
            id="selector-q"
            value={value.q}
            placeholder="e.g. trail"
            onChange={(e) => onChange({ ...value, q: e.target.value })}
            data-testid="selector-q"
          />
        </Field>
      </div>
      <Card>
        <CardTitle actions={preview.isFetching ? <Spinner className="h-4 w-4" /> : null}>
          <span data-testid="preview-products-count" data-count={preview.data?.total ?? ''}>
            {preview.data ? `${formatNumber(preview.data.total)} products match` : 'Matching products'}
          </span>
        </CardTitle>
        <ErrorNote error={preview.error} />
        {!preview.data && preview.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : preview.data && preview.data.products.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No active products match. Loosen the filters.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(preview.data?.products ?? []).map((p) => (
              <li
                key={p.id}
                data-testid="preview-product"
                className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800"
              >
                <div className="aspect-square">
                  <ProductImage src={p.imageUrl} alt={p.title} className="text-base" />
                </div>
                <div className="p-2">
                  <p className="line-clamp-2 text-xs font-medium">{p.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatMoney(p.priceMinCents, p.currency)}
                    {!p.available ? (
                      <Badge tone="red" className="ml-1">
                        out of stock
                      </Badge>
                    ) : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
