'use client';

import { Button, ErrorNote, Field, Input } from '@cip/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { postJson } from '@/lib/public-api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await postJson('/v1/auth/login', { email: form.get('email'), password: form.get('password') });
      router.replace(params.get('next') || '/live');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New merchant?{' '}
          <Link href="/signup" className="font-medium text-[var(--brand)] dark:text-blue-400">
            Create a store
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {error ? <ErrorNote error={new Error(error)} /> : null}
        <Button type="submit" className="w-full" loading={loading} data-testid="login-submit">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
