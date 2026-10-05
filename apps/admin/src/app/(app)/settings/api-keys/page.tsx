'use client';

import { PERMISSIONS } from '@cip/contracts';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorNote,
  Field,
  formatDateTime,
  Select,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/shell';
import { api, errorMessage, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';

type Permission = (typeof PERMISSIONS)[number];

export default function ApiKeysPage() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'publishable' | 'secret'>('secret');
  const [scopes, setScopes] = useState<Permission[]>(['catalog:read']);
  const [secret, setSecret] = useState<string | null>(null);
  const keys = useQuery({
    queryKey: queryKeys.apiKeys(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/api-keys')),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(tenantId) });
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/api-keys', { body: { kind, scopes: kind === 'secret' ? scopes : [] } }),
      ),
    onSuccess: (data) => {
      setSecret(data.secret);
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => api.DELETE('/v1/admin/api-keys/{id}', { params: { path: { id } } }),
    onSuccess: refresh,
  });
  return (
    <div>
      <PageHeader
        title="API keys"
        description="pk_ keys only send tracking events; sk_ keys call the admin API with the scopes you choose. Only a hash is stored."
      />
      {secret ? (
        <Card className="mb-4 border-emerald-300">
          <p className="text-sm font-medium">Copy this key now. It will not be shown again.</p>
          <code
            className="mt-2 block break-all rounded bg-slate-100 p-2 text-sm dark:bg-slate-800"
            data-testid="new-key-secret"
          >
            {secret}
          </code>
        </Card>
      ) : null}
      {create.error ? <ErrorNote error={new Error(errorMessage(create.error))} /> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table>
            <thead>
              <tr>
                <Th>Prefix</Th>
                <Th>Kind</Th>
                <Th>Scopes</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(keys.data?.data ?? []).map((k) => (
                <tr key={k.id} data-testid="api-key-row">
                  <Td className="font-mono">{k.prefix}…</Td>
                  <Td>{k.kind}</Td>
                  <Td className="text-xs">{k.scopes.join(', ') || '—'}</Td>
                  <Td>{formatDateTime(k.lastUsedAt)}</Td>
                  <Td>
                    {k.revokedAt ? <Badge tone="red">revoked</Badge> : <Badge tone="green">active</Badge>}
                  </Td>
                  <Td className="text-right">
                    {!k.revokedAt ? (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(k.id)}>
                        Revoke
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <Card>
          <CardTitle>Create key</CardTitle>
          <div className="space-y-3">
            <Field label="Kind" htmlFor="kind">
              <Select
                id="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'publishable' | 'secret')}
              >
                <option value="secret">Secret (sk_live_)</option>
                <option value="publishable">Publishable (pk_live_)</option>
              </Select>
            </Field>
            {kind === 'secret' ? (
              <fieldset className="space-y-1 text-sm">
                <legend className="mb-1 font-medium">Scopes</legend>
                {PERMISSIONS.map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={scopes.includes(p)}
                      onChange={(e) =>
                        setScopes((s) => (e.target.checked ? [...s, p] : s.filter((x) => x !== p)))
                      }
                    />
                    {p}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <Button onClick={() => create.mutate()} loading={create.isPending} data-testid="create-api-key">
              Create key
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
