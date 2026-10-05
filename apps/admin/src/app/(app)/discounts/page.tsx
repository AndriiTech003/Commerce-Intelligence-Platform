'use client';

import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorNote,
  Field,
  formatMoney,
  Input,
  parseMoneyInput,
  Select,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/shell';
import type { paths } from '@cip/api-client';
import { api, errorMessage, unwrap } from '@/lib/api';

type DiscountBody = paths['/v1/admin/discounts']['post']['requestBody']['content']['application/json'];
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';

export default function DiscountsPage() {
  const tenantId = useTenantId();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const discounts = useQuery({
    queryKey: queryKeys.discounts(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/discounts')),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.discounts(tenantId) });
  const create = useMutation({
    mutationFn: async (body: DiscountBody) => unwrap(await api.POST('/v1/admin/discounts', { body })),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: async (input: { id: string; active: boolean }) =>
      unwrap(
        await api.PATCH('/v1/admin/discounts/{id}', {
          params: { path: { id: input.id } },
          body: { active: input.active },
        }),
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.DELETE('/v1/admin/discounts/{id}', { params: { path: { id } } }),
    onSuccess: refresh,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawValue = String(form.get('value') ?? '');
    const value = type === 'percent' ? Number(rawValue) : (parseMoneyInput(rawValue) ?? 0);
    const usageLimit = Number(form.get('usageLimit')) || null;
    const perCustomerLimit = Number(form.get('perCustomerLimit')) || null;
    const endsAt = String(form.get('endsAt') ?? '');
    create.mutate({
      code: String(form.get('code')).toUpperCase(),
      type,
      value,
      minSubtotalCents: parseMoneyInput(String(form.get('minSubtotal') || '0')) ?? 0,
      usageLimit,
      perCustomerLimit,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      active: true,
    });
    event.currentTarget.reset();
  };

  return (
    <div>
      <PageHeader title="Discounts" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ErrorNote error={discounts.error} />
          {(discounts.data?.data ?? []).length === 0 ? (
            <EmptyState title="No discount codes" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Value</Th>
                  <Th>Minimum</Th>
                  <Th>Used</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(discounts.data?.data ?? []).map((d) => (
                  <tr key={d.id} data-testid="discount-row">
                    <Td className="font-mono">{d.code}</Td>
                    <Td>{d.type === 'percent' ? `${d.value}%` : formatMoney(d.value)}</Td>
                    <Td>{formatMoney(d.minSubtotalCents)}</Td>
                    <Td>
                      {d.usedCount}
                      {d.usageLimit ? ` / ${d.usageLimit}` : ''}
                    </Td>
                    <Td>
                      <Badge tone={d.active ? 'green' : 'neutral'}>{d.active ? 'active' : 'inactive'}</Badge>
                    </Td>
                    <Td className="space-x-2 text-right">
                      {can('catalog:write') ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggle.mutate({ id: d.id, active: !d.active })}
                          >
                            {d.active ? 'Disable' : 'Enable'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)}>
                            Delete
                          </Button>
                        </>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        {can('catalog:write') ? (
          <Card>
            <CardTitle>New code</CardTitle>
            <form onSubmit={submit} className="space-y-3">
              <Field label="Code" htmlFor="code">
                <Input id="code" name="code" required pattern="[A-Za-z0-9_-]{2,64}" />
              </Field>
              <Field label="Type" htmlFor="type">
                <Select
                  id="type"
                  value={type}
                  onChange={(e) => setType(e.target.value as 'percent' | 'fixed')}
                >
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
              </Field>
              <Field label={type === 'percent' ? 'Percent (1–100)' : 'Amount'} htmlFor="value">
                <Input id="value" name="value" required inputMode="decimal" />
              </Field>
              <Field label="Minimum subtotal" htmlFor="minSubtotal">
                <Input id="minSubtotal" name="minSubtotal" inputMode="decimal" placeholder="0" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Usage limit" htmlFor="usageLimit">
                  <Input id="usageLimit" name="usageLimit" inputMode="numeric" />
                </Field>
                <Field label="Per customer" htmlFor="perCustomerLimit">
                  <Input id="perCustomerLimit" name="perCustomerLimit" inputMode="numeric" />
                </Field>
              </div>
              <Field label="Ends at" htmlFor="endsAt">
                <Input id="endsAt" name="endsAt" type="datetime-local" />
              </Field>
              {create.error ? <ErrorNote error={new Error(errorMessage(create.error))} /> : null}
              <Button type="submit" loading={create.isPending} data-testid="create-discount">
                Create
              </Button>
            </form>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
