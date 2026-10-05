import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategories, getProducts, getStore } from '@/lib/server-api';
import { catalogQueryFromParams, firstParam, type RawSearchParams } from '@/lib/catalog-query';
import { CategoryBrowser } from '@/components/category-browser';
import { TrackView } from '@/components/track-view';
import { PersonalizedCampaign } from '@/components/personalization/personalized-campaign';

export const revalidate = 60;

type Props = { params: Promise<{ store: string; slug: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: storeSlug, slug } = await params;
  const store = await getStore(storeSlug).catch(() => null);
  if (!store) return {};
  const category = (await getCategories(store).catch(() => [])).find((c) => c.slug === slug);
  return category
    ? {
        title: category.name,
        description: `${category.name} at ${store.name}${category.productCount ? `: ${category.productCount} products` : ''}. ${store.tagline}`,
      }
    : {};
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ store: storeSlug, slug }, raw] = await Promise.all([params, searchParams]);
  const store = await getStore(storeSlug);
  if (!store) notFound();
  const categories = await getCategories(store);
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();
  const query = catalogQueryFromParams(raw, { category: slug, limit: 24 });
  const list = await getProducts(store, query);
  const current: Record<string, string> = {};
  for (const key of ['brand', 'price', 'sort']) {
    const value = firstParam(raw[key]);
    if (value) current[key] = value;
  }
  const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : undefined;
  const children = categories.filter((c) => c.parentId === category.id);
  const stateKey = JSON.stringify(current);

  return (
    <div className="space-y-6">
      <TrackView
        events={[
          { type: 'page_viewed', props: { page_type: 'category' } },
          {
            type: 'product_list_viewed',
            props: {
              list_id: category.slug,
              category_path: category.path,
              product_ids: list.data.slice(0, 100).map((p) => p.id),
            },
          },
        ]}
      />
      <div>
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500 dark:text-slate-400">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:underline">
                Home
              </Link>
            </li>
            {parent ? (
              <li className="flex items-center gap-1">
                <span aria-hidden="true">/</span>
                <Link href={`/c/${parent.slug}`} className="hover:underline">
                  {parent.name}
                </Link>
              </li>
            ) : null}
            <li className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <span aria-current="page">{category.name}</span>
            </li>
          </ol>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="category-title">
          {category.name}
        </h1>
        {children.length ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/c/${child.slug}`}
                  className="inline-block rounded-full border border-slate-200 px-3 py-1 text-sm hover:border-[var(--brand)] dark:border-slate-700"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <PersonalizedCampaign placement="category_banner" />
      <CategoryBrowser
        key={stateKey}
        basePath={`/c/${category.slug}`}
        initial={list}
        query={query}
        params={current}
        currency={store.currency}
      />
    </div>
  );
}
