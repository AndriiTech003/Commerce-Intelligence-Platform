'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';
import { ProductImage } from './components';
import { formatMoney } from './format';

export interface CampaignCreativeView {
  headline: string;
  body: string;
  cta: string;
  tone?: string | null;
}

export interface CampaignProductView {
  id: string;
  title: string;
  slug: string;
  priceMinCents: number | null;
  currency: string;
  imageUrl: string | null;
}

export type CampaignPlacement = 'home_hero' | 'pdp_sidebar' | 'cart_upsell' | 'category_banner';

export interface CampaignBlockProps {
  placement: CampaignPlacement;
  creative: CampaignCreativeView;
  products: CampaignProductView[];
  productHref?: (product: CampaignProductView) => string;
  onCtaClick?: () => void;
  onProductClick?: (product: CampaignProductView, position: number) => void;
  ctaHref?: string;
  badge?: ReactNode;
  className?: string;
  preview?: boolean;
  eyebrow?: string;
  testId?: string;
}

const layouts: Record<CampaignPlacement, { wrapper: string; products: number; grid: string }> = {
  home_hero: {
    wrapper: 'rounded-2xl bg-[var(--brand,#2563eb)] p-6 text-white sm:p-10',
    products: 4,
    grid: 'mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4',
  },
  category_banner: {
    wrapper: 'rounded-xl border border-[var(--brand,#2563eb)] bg-white p-5 dark:bg-slate-900',
    products: 3,
    grid: 'mt-4 grid grid-cols-3 gap-3',
  },
  pdp_sidebar: {
    wrapper: 'rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900',
    products: 2,
    grid: 'mt-3 grid grid-cols-2 gap-2',
  },
  cart_upsell: {
    wrapper: 'rounded-xl border border-dashed border-[var(--brand,#2563eb)] bg-white p-4 dark:bg-slate-900',
    products: 3,
    grid: 'mt-3 grid grid-cols-3 gap-2',
  },
};

export function CampaignBlock({
  placement,
  creative,
  products,
  productHref = (p) => `/p/${p.slug}`,
  onCtaClick,
  onProductClick,
  ctaHref,
  badge,
  className,
  preview,
  eyebrow = 'Featured',
  testId = 'campaign-block',
}: CampaignBlockProps) {
  const layout = layouts[placement];
  const hero = placement === 'home_hero';
  const shown = products.slice(0, layout.products);
  const firstHref = ctaHref ?? (shown[0] ? productHref(shown[0]) : '#');
  return (
    <section
      className={cn('relative', layout.wrapper, className)}
      data-testid={testId}
      data-placement={placement}
      data-tone={creative.tone ?? ''}
      aria-label={eyebrow}
    >
      {badge ? <div className="absolute right-3 top-3">{badge}</div> : null}
      <p
        className={cn(
          'text-xs font-medium uppercase tracking-widest',
          hero ? 'text-white' : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {eyebrow}
      </p>
      <h2
        className={cn('mt-1 font-bold tracking-tight', hero ? 'text-2xl sm:text-4xl' : 'text-lg')}
        data-testid="campaign-headline"
      >
        {creative.headline}
      </h2>
      <p
        className={cn(
          'mt-2 max-w-2xl',
          hero ? 'text-base text-white' : 'text-sm text-slate-600 dark:text-slate-300',
        )}
      >
        {creative.body}
      </p>
      <a
        href={preview ? undefined : firstHref}
        onClick={onCtaClick}
        data-testid="campaign-cta"
        className={cn(
          'mt-4 inline-flex h-10 items-center rounded-full px-5 text-sm font-semibold focus:outline-none focus-visible:ring-2',
          hero
            ? 'bg-white text-slate-900 hover:bg-white/90'
            : 'bg-[var(--brand,#2563eb)] text-white hover:opacity-90',
        )}
      >
        {creative.cta}
      </a>
      {shown.length > 0 ? (
        <ul className={layout.grid}>
          {shown.map((product, index) => (
            <li key={product.id}>
              <a
                href={preview ? undefined : productHref(product)}
                onClick={() => onProductClick?.(product, index)}
                className={cn(
                  'block overflow-hidden rounded-lg text-left focus:outline-none focus-visible:ring-2',
                  hero ? 'bg-black/20 hover:bg-black/30' : 'bg-white hover:shadow-sm dark:bg-slate-950',
                )}
                data-testid="campaign-product"
              >
                <div className="aspect-square w-full overflow-hidden">
                  <ProductImage src={product.imageUrl} alt={product.title} />
                </div>
                <div className="p-2">
                  <p className={cn('line-clamp-2 text-xs font-medium', hero ? 'text-white' : '')}>
                    {product.title}
                  </p>
                  {product.priceMinCents !== null ? (
                    <p className={cn('text-xs', hero ? 'text-white' : 'text-slate-500 dark:text-slate-400')}>
                      {formatMoney(product.priceMinCents, product.currency)}
                    </p>
                  ) : null}
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
