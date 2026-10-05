import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmptyState } from '@cip/ui';
import { getStore, searchProducts } from '@/lib/server-api';
import { catalogQueryFromParams, firstParam, type RawSearchParams } from '@/lib/catalog-query';
import { ProductGrid } from '@/components/product-grid';
import { TrackView } from '@/components/track-view';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ store: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = firstParam((await searchParams).q)?.trim();
  return { title: q ? `Search: ${q}` : 'Search' };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const [{ store: storeSlug }, raw] = await Promise.all([params, searchParams]);
  const store = await getStore(storeSlug);
  if (!store) notFound();
  const q = firstParam(raw.q)?.trim().slice(0, 200) ?? '';
  const list = q
    ? await searchProducts(store, catalogQueryFromParams(raw, { q, limit: 48 }))
    : { data: [], nextCursor: null };

  return (
    <div className="space-y-6">
      {q ? (
        <TrackView
          events={[
            { type: 'page_viewed', props: { page_type: 'other' } },
            {
              type: 'search_performed',
              props: {
                query: q,
                results_count: list.data.length,
                ...(list.data[0]?.categoryPath ? { category_path: list.data[0].categoryPath } : {}),
              },
            },
          ]}
        />
      ) : null}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="search-title">
          {q ? <>Results for &ldquo;{q}&rdquo;</> : 'Search'}
        </h1>
        {q ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400" data-testid="results-count">
            {list.data.length}
            {list.nextCursor ? '+' : ''} products
          </p>
        ) : null}
      </div>
      {!q ? (
        <EmptyState
          title="What are you looking for?"
          description="Type in the search box above to find products."
        />
      ) : list.data.length ? (
        <ProductGrid products={list.data} />
      ) : (
        <EmptyState title="No matches" description="Check the spelling or try a more general term." />
      )}
    </div>
  );
}
