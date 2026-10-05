'use client';

import Link from 'next/link';
import { useCart } from '@/lib/use-cart';

export function CartLink() {
  const { data } = useCart();
  const count = data?.itemsCount ?? 0;
  return (
    <Link
      href="/cart"
      data-testid="cart-link"
      className="relative inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] dark:text-slate-200 dark:hover:bg-slate-800"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      >
        <path
          d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="20" r="1.2" />
        <circle cx="17" cy="20" r="1.2" />
      </svg>
      <span className="sr-only sm:not-sr-only">Cart</span>
      <span
        data-testid="cart-count"
        className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--brand)] px-1.5 text-xs font-semibold text-white"
      >
        {count}
      </span>
      <span className="sr-only">{count === 1 ? 'item' : 'items'}</span>
    </Link>
  );
}
