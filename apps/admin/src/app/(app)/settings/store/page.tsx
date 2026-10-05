'use client';

import { Button, Card, ErrorNote, Field, Input } from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { PageHeader } from '@/components/shell';
import { api, errorMessage, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

export default function StoreSettingsPage() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.settings(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/settings')),
  });
  const save = useMutation({
    mutationFn: async (body: {
      name: string;
      brandColor: string;
      tagline: string;
      lowStockThreshold: number;
    }) => unwrap(await api.PATCH('/v1/admin/settings', { body })),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings(tenantId), data),
  });
  const s = settings.data;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      name: String(form.get('name')),
      brandColor: String(form.get('brandColor')),
      tagline: String(form.get('tagline')),
      lowStockThreshold: Number(form.get('lowStockThreshold')),
    });
  };
  return (
    <div>
      <PageHeader title="Store settings" />
      <ErrorNote error={settings.error} />
      {s ? (
        <Card className="max-w-xl">
          <form onSubmit={submit} className="space-y-4" key={`${s.name}${s.brandColor}`}>
            <Field label="Store name" htmlFor="name">
              <Input id="name" name="name" defaultValue={s.name} required />
            </Field>
            <Field label="Brand color" htmlFor="brandColor">
              <Input
                id="brandColor"
                name="brandColor"
                type="color"
                defaultValue={s.brandColor}
                className="h-10 w-20 p-1"
              />
            </Field>
            <Field label="Tagline" htmlFor="tagline">
              <Input id="tagline" name="tagline" defaultValue={s.tagline} />
            </Field>
            <Field label="Low stock threshold" htmlFor="lowStockThreshold">
              <Input
                id="lowStockThreshold"
                name="lowStockThreshold"
                type="number"
                min={0}
                defaultValue={s.lowStockThreshold}
              />
            </Field>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Storefront: <span className="font-mono">{s.slug}.localhost:4130</span> · Currency {s.currency} ·
              Tracking key{' '}
              <span className="font-mono">{s.trackingKey ? `${s.trackingKey.slice(0, 12)}…` : 'none'}</span>
            </p>
            {save.error ? <ErrorNote error={new Error(errorMessage(save.error))} /> : null}
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
