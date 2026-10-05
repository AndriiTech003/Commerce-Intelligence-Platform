import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { renderMarkdown } from '@cip/ui';
import { getProduct, getStore } from '@/lib/server-api';
import { Gallery } from '@/components/gallery';
import { ProductPurchase } from '@/components/product-purchase';
import { PersonalizedCampaign } from '@/components/personalization/personalized-campaign';
import { RecommendationsSection } from '@/components/personalization/recommendations-section';

export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

type Props = { params: Promise<{ store: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: storeSlug, slug } = await params;
  const store = await getStore(storeSlug).catch(() => null);
  const product = store ? await getProduct(store, slug).catch(() => null) : null;
  if (!product) return {};
  return { title: product.title, description: product.description.slice(0, 160) };
}

export default async function ProductPage({ params }: Props) {
  const { store: storeSlug, slug } = await params;
  const store = await getStore(storeSlug);
  if (!store) notFound();
  const product = await getProduct(store, slug);
  if (!product || product.status !== 'active') notFound();
  const images = [...product.images].sort((a, b) => a.position - b.position);

  return (
    <article className="space-y-10" data-testid="product-page" data-product-id={product.id}>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500 dark:text-slate-400">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        {product.categoryName ? (
          <>
            <span aria-hidden="true"> / </span>
            <span>{product.categoryName}</span>
          </>
        ) : null}
      </nav>
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <Gallery images={images.length ? images : [{ url: '', alt: product.title }]} title={product.title} />
        <div className="space-y-6">
          <div className="space-y-1">
            {product.brand ? (
              <p
                className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                data-testid="product-brand"
              >
                {product.brand}
              </p>
            ) : null}
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="product-title">
              {product.title}
            </h1>
          </div>
          <ProductPurchase product={product} />
          <PersonalizedCampaign placement="pdp_sidebar" productId={product.id} />
          {product.description ? (
            <section
              aria-labelledby="description-heading"
              className="border-t border-slate-200 pt-6 dark:border-slate-800"
            >
              <h2 id="description-heading" className="mb-2 text-base font-semibold">
                Description
              </h2>
              <div
                className="prose-lite text-sm text-slate-700 dark:text-slate-300"
                data-testid="product-description"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(product.description) }}
              />
            </section>
          ) : null}
        </div>
      </div>
      <RecommendationsSection
        type="similar"
        productId={product.id}
        limit={8}
        title="Similar products"
        testId="recommendations-similar"
      />
      <RecommendationsSection
        type="bought_together"
        productId={product.id}
        limit={4}
        title="Frequently bought together"
        testId="recommendations-bought-together"
      />
    </article>
  );
}
