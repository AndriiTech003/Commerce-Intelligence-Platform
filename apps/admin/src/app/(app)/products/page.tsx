'use client';

import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  formatMoney,
  Input,
  ProductImage,
  Select,
  Skeleton,
  statusTone,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CsvImport } from '@/components/csv-import';
import { LoadMore } from '@/components/load-more';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';

function ProductList() {
  const tenantId = useTenantId();
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const lowStock = params.get('lowStock') === 'true';
  const [search, setSearch] = useState(q);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search === q) return;
      const next = new URLSearchParams(params.toString());
      if (search) next.set('q', search);
      else next.delete('q');
      router.replace(`/products?${next.toString()}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, q, params, router]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/products?${next.toString()}`);
  };

  const list = useInfiniteQuery({
    queryKey: queryKeys.products.list(tenantId, { q, status, lowStock }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/v1/admin/products', {
          params: {
            query: {
              limit: 25,
              ...(q ? { q } : {}),
              ...(status ? { status: status as 'draft' | 'active' | 'archived' } : {}),
              ...(lowStock ? { lowStock: 'true' as const } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div>
      <PageHeader
        title="Products"
        actions={
          can('catalog:write') ? (
            <Link href="/products/new">
              <Button data-testid="new-product">New product</Button>
            </Link>
          ) : null
        }
      />
      {can('catalog:write') ? <CsvImport /> : null}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          aria-label="Search products"
          placeholder="Search (typos are fine)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="product-search"
        />
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          className="w-40"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(e) => setFilter('lowStock', e.target.checked ? 'true' : '')}
          />{' '}
          Low stock only
        </label>
      </div>
      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No products found"
          description="Try a different search or create your first product."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>
                <span className="sr-only">Image</span>
              </Th>
              <Th>Title</Th>
              <Th>Status</Th>
              <Th>Category</Th>
              <Th className="text-right">Price from</Th>
              <Th className="text-right">Available</Th>
              <Th className="text-right">Variants</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((p) => (
              <tr key={p.id} data-testid="product-row">
                <Td className="w-12">
                  <div className="h-10 w-10 overflow-hidden rounded">
                    <ProductImage src={p.imageUrl} alt={p.title} className="text-xs" />
                  </div>
                </Td>
                <Td>
                  <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{p.brand}</div>
                </Td>
                <Td>
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                </Td>
                <Td>{p.categoryName ?? '—'}</Td>
                <Td className="text-right tabular-nums">{formatMoney(p.priceMinCents, p.currency)}</Td>
                <Td className="text-right tabular-nums">{p.totalAvailable}</Td>
                <Td className="text-right tabular-nums">{p.variantCount}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <LoadMore
        hasMore={Boolean(list.hasNextPage)}
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductList />
    </Suspense>
  );
}
