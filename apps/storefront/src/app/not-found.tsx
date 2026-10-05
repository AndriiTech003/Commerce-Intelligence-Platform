import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className="text-sm font-medium underline">
        Back to the store
      </Link>
    </main>
  );
}
