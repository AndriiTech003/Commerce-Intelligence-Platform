'use client';

import Link from 'next/link';
import { useCustomer } from './customer-provider';

export function AccountLink() {
  const { customer } = useCustomer();
  return (
    <Link
      href="/account"
      data-testid="account-link"
      className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {customer ? (customer.name?.split(' ')[0] ?? 'Account') : 'Sign in'}
    </Link>
  );
}
