'use client';

import { Button, ErrorNote, Field, Input, Select } from '@cip/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { postJson } from '@/lib/public-api';

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [slug, setSlug] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await postJson('/v1/auth/signup', {
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
        storeName: form.get('storeName'),
        storeSlug: form.get('storeSlug'),
        currency: form.get('currency'),
        demoCatalog: form.get('demoCatalog') === 'on',
      });
      router.replace('/products');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Create your store"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-[var(--brand)] dark:text-blue-400">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" required />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters">
          <Input id="password" name="password" type="password" minLength={8} required />
        </Field>
        <Field label="Store name" htmlFor="storeName">
          <Input
            id="storeName"
            name="storeName"
            required
            onChange={(event) =>
              setSlug(
                event.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, '')
                  .slice(0, 32),
              )
            }
          />
        </Field>
        <Field label="Store address" htmlFor="storeSlug" hint={`${slug || 'your-store'}.localhost`}>
          <Input
            id="storeSlug"
            name="storeSlug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            pattern="[a-z0-9-]{3,32}"
            required
          />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Select id="currency" name="currency" defaultValue="USD">
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="demoCatalog" /> Fill with a demo catalog
        </label>
        {error ? <ErrorNote error={new Error(error)} /> : null}
        <Button type="submit" className="w-full" loading={loading} data-testid="signup-submit">
          Create store
        </Button>
      </form>
    </AuthCard>
  );
}
