import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CampaignBlock, EmptyState } from '@cip/ui';
import { getCategories, getProducts, getStore } from '@/lib/server-api';
import { ProductGrid } from '@/components/product-grid';
import { TrackView } from '@/components/track-view';
import { PersonalizedCampaign } from '@/components/personalization/personalized-campaign';
import { RecommendationsSection } from '@/components/personalization/recommendations-section';

export const revalidate = 60;

export default async function HomePage({ params }: { params: Promise<{ store: string }> }) {
  const { store: slug } = await params;
  const store = await getStore(slug);
  if (!store) notFound();
  const [categories, newest, popular] = await Promise.all([
    getCategories(store),
    getProducts(store, { sort: 'newest', limit: 12 }),
    getProducts(store, { sort: 'relevance', limit: 8 }),
  ]);
  const topLevel = categories.filter((category) => category.parentId === null);
  const heroProducts = popular.data
    .filter((product) => product.available)
    .slice(0, 4)
    .map((product) => ({
      id: product.id,
      title: product.title,
      slug: product.slug,
      priceMinCents: product.priceMinCents,
      currency: product.currency ?? store.currency,
      imageUrl: product.imageUrl,
    }));

  return (
    <div className="space-y-12">
      <TrackView events={[{ type: 'page_viewed', props: { page_type: 'home' } }]} />
      <PersonalizedCampaign
        placement="home_hero"
        heading={<h1 className="sr-only">{store.name}</h1>}
        fallback={
          <div>
            <h1 className="sr-only">{store.name}</h1>
            <CampaignBlock
              placement="home_hero"
              eyebrow="Welcome to"
              testId="home-hero"
              creative={{
                headline: store.name,
                body: store.tagline,
                cta: topLevel[0] ? `Shop ${topLevel[0].name}` : 'Browse the catalog',
              }}
              ctaHref={topLevel[0] ? `/c/${topLevel[0].slug}` : '/search'}
              products={heroProducts}
            />
          </div>
        }
      />

      <RecommendationsSection
        type="for_you"
        limit={8}
        title="For you"
        description="Personal picks based on what you browse"
        testId="recommendations-for-you"
        explainable
      />

      {topLevel.length ? (
        <section aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="mb-4 text-xl font-semibold">
            Shop by category
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {topLevel.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.slug}`}
                  data-testid="category-tile"
                  className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 transition hover:border-[var(--brand)] hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] dark:border-slate-800 dark:bg-slate-900"
                >
                  <span className="font-medium">{category.name}</span>
                  {category.productCount !== undefined ? (
                    <span className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {category.productCount} products
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="new-heading" data-testid="new-arrivals">
        <h2 id="new-heading" className="mb-4 text-xl font-semibold">
          New arrivals
        </h2>
        {newest.data.length ? (
          <ProductGrid products={newest.data} />
        ) : (
          <EmptyState title="No products yet" description="Check back soon — new items are on their way." />
        )}
      </section>

      {popular.data.length ? (
        <section aria-labelledby="popular-heading" data-testid="popular">
          <h2 id="popular-heading" className="mb-4 text-xl font-semibold">
            Popular right now
          </h2>
          <ProductGrid products={popular.data} />
        </section>
      ) : null}
    </div>
  );
}
