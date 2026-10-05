import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { getCategories, getStore } from '@/lib/server-api';
import { isValidStoreSlug } from '@/lib/store-slug';
import { accessibleBrand } from '@/lib/brand-color';
import { Providers } from '@/components/providers';
import { SearchBox } from '@/components/search-box';
import { CartLink } from '@/components/cart-link';
import { AccountLink } from '@/components/account-link';
import { ConsentBanner } from '@/components/consent-banner';
import { DemoModeToggle } from '@/components/personalization/demo-mode';

export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams(): Array<{ store: string }> {
  return [];
}

type Params = Promise<{ store: string }>;

const BRAND = /^#[0-9a-fA-F]{3,8}$/;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { store: slug } = await params;
  const store = isValidStoreSlug(slug) ? await getStore(slug).catch(() => null) : null;
  if (!store) return { title: 'Store' };
  return {
    title: { default: store.name, template: `%s · ${store.name}` },
    description: store.tagline,
  };
}

export default async function StoreLayout({ children, params }: { children: ReactNode; params: Params }) {
  const { store: slug } = await params;
  if (!isValidStoreSlug(slug)) notFound();
  const store = await getStore(slug);
  if (!store) notFound();
  const categories = (await getCategories(store)).filter((category) => category.parentId === null);
  const { brand, brandOnDark } = accessibleBrand(BRAND.test(store.brandColor) ? store.brandColor : '#2563eb');
  const style = { '--brand': brand, '--brand-on-dark': brandOnDark } as CSSProperties;

  return (
    <div style={style} className="flex min-h-screen flex-col" data-store={store.slug}>
      <Providers store={store}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight"
              data-testid="store-name"
            >
              <span aria-hidden="true" className="inline-block h-6 w-6 rounded-md bg-[var(--brand)]" />
              {store.name}
            </Link>
            <div className="order-last w-full md:order-none md:mx-2 md:w-auto md:flex-1">
              <SearchBox />
            </div>
            <nav aria-label="Account" className="ml-auto flex items-center gap-1">
              <AccountLink />
              <CartLink />
            </nav>
          </div>
          {categories.length ? (
            <nav aria-label="Categories" className="border-t border-slate-100 dark:border-slate-900">
              <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 text-sm">
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={`/c/${category.slug}`}
                      data-testid="category-link"
                      className="block whitespace-nowrap rounded-full px-3 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </header>
        <main id="main" className="mx-auto min-h-screen w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white py-8 text-sm text-slate-500 dark:text-slate-400 dark:border-slate-800 dark:bg-slate-950">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:justify-between">
            <span>
              © {store.name} · {store.tagline}
            </span>
            <div className="flex flex-col gap-2 sm:items-end">
              <span>Powered by Commerce Intelligence Platform</span>
              <DemoModeToggle />
            </div>
          </div>
        </footer>
        <ConsentBanner />
      </Providers>
    </div>
  );
}
