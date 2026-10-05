'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@cip/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Skeleton,
  formatDateTime,
  formatMoney,
  statusTone,
} from '@cip/ui';
import { api } from '@/lib/browser-api';
import { errorMessage } from '@/lib/problem';
import { useCustomer } from './customer-provider';

function LoginForm() {
  const { login } = useCustomer();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(data.get('email') ?? ''), String(data.get('password') ?? ''));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <form className="space-y-4" onSubmit={submit} data-testid="login-form">
        <h2 className="text-lg font-semibold">Sign in</h2>
        <Field label="Email" htmlFor="login-email">
          <Input id="login-email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={busy} data-testid="login-submit">
          Sign in
        </Button>
      </form>
    </Card>
  );
}

function RegisterForm() {
  const { register } = useCustomer();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(String(data.get('email') ?? ''), password, String(data.get('name') ?? ''));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <form className="space-y-4" onSubmit={submit} data-testid="register-form">
        <h2 className="text-lg font-semibold">Create an account</h2>
        <Field label="Name" htmlFor="register-name">
          <Input id="register-name" name="name" autoComplete="name" required />
        </Field>
        <Field label="Email" htmlFor="register-email">
          <Input id="register-email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="register-password" hint="At least 8 characters">
          <Input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={busy} data-testid="register-submit">
          Create account
        </Button>
      </form>
    </Card>
  );
}

function OrderHistory({ customerId }: { customerId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['account', customerId, 'orders'],
    queryFn: async () => unwrap(await api().GET('/v1/storefront/account/orders')),
  });
  if (isLoading) return <Skeleton className="h-32" />;
  if (error) return <ErrorNote error={error} />;
  if (!data?.data.length) {
    return (
      <EmptyState
        title="No orders yet"
        action={
          <Link
            href="/"
            className="text-sm font-medium text-[var(--brand)] underline dark:text-[var(--brand-on-dark)]"
          >
            Start shopping
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="order-history">
      {data.data.map((order) => (
        <li key={order.id}>
          <Link
            href={`/orders/${order.id}`}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <span className="font-medium">#{order.number}</span>
            <span className="text-slate-500 dark:text-slate-400">{formatDateTime(order.placedAt)}</span>
            <span className="text-slate-500 dark:text-slate-400">{order.itemsCount} items</span>
            <Badge tone={statusTone(order.status)}>{order.status}</Badge>
            <span className="font-semibold">{formatMoney(order.totalCents, order.currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AccountView() {
  const { customer, status, logout } = useCustomer();
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <Skeleton className="h-48" />;

  if (!customer) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <LoginForm />
        <RegisterForm />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{customer.name}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="customer-email">
            {customer.email}
          </p>
        </div>
        <Button
          variant="secondary"
          data-testid="logout"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await logout();
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out
        </Button>
      </Card>
      <Card>
        <h2 className="mb-2 text-base font-semibold">Order history</h2>
        <OrderHistory customerId={customer.id} />
      </Card>
    </div>
  );
}
