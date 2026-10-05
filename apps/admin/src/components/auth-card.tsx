import type { ReactNode } from 'react';

export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Commerce Intelligence</p>
        <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
        {children}
        {footer ? <div className="mt-6 text-sm text-slate-500 dark:text-slate-400">{footer}</div> : null}
      </div>
    </div>
  );
}
