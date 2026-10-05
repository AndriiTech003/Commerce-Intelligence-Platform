'use client';

import { Button, ErrorNote, Field, Input } from '@cip/ui';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { postJson } from '@/lib/public-api';

export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await postJson(`/v1/invitations/${encodeURIComponent(decodeURIComponent(params.token))}/accept`, {
        name: form.get('name'),
        password: form.get('password'),
      });
      router.replace('/products');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Join the team">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Choose your name and a password. If you already have an account, use your existing password.
        </p>
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" minLength={8} required />
        </Field>
        {error ? <ErrorNote error={new Error(error)} /> : null}
        <Button type="submit" className="w-full" loading={loading} data-testid="accept-invite">
          Accept invitation
        </Button>
      </form>
    </AuthCard>
  );
}
