import Link from 'next/link';

export default function StoreNotFound() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">404</p>
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        The product may have been removed or the link is incorrect.
      </p>
      <Link
        href="/"
        className="text-sm font-medium text-[var(--brand)] underline dark:text-[var(--brand-on-dark)]"
      >
        Continue shopping
      </Link>
    </div>
  );
}
