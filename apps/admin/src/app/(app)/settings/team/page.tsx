'use client';

import { ROLES } from '@cip/contracts';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorNote,
  Field,
  formatDateTime,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/shell';
import { api, errorMessage, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';

type Role = (typeof ROLES)[number];

export default function TeamPage() {
  const tenantId = useTenantId();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const members = useQuery({
    queryKey: queryKeys.members(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/members')),
  });
  const invitations = useQuery({
    queryKey: queryKeys.invitations(tenantId),
    queryFn: async () => unwrap(await api.GET('/v1/admin/invitations')),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.members(tenantId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(tenantId) });
  };
  const changeRole = useMutation({
    mutationFn: async (input: { userId: string; role: Role }) =>
      unwrap(
        await api.PATCH('/v1/admin/members/{userId}', {
          params: { path: { userId: input.userId } },
          body: { role: input.role },
        }),
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const result = await api.DELETE('/v1/admin/members/{userId}', { params: { path: { userId } } });
      if (!result.response.ok) unwrap(result);
    },
    onSuccess: refresh,
  });
  const invite = useMutation({
    mutationFn: async (body: { email: string; role: Exclude<Role, 'owner'> }) =>
      unwrap(await api.POST('/v1/admin/invitations', { body })),
    onSuccess: (data) => {
      setNotice(`Invitation sent to ${data.email}. Check Mailpit at http://127.0.0.1:8025.`);
      refresh();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    invite.mutate({
      email: String(form.get('email')),
      role: String(form.get('role')) as Exclude<Role, 'owner'>,
    });
    event.currentTarget.reset();
  };
  const error = changeRole.error ?? remove.error ?? invite.error;
  return (
    <div>
      <PageHeader
        title="Team & roles"
        description="Roles map to permissions; the API enforces them on every request."
      />
      {error ? <ErrorNote error={new Error(errorMessage(error))} /> : null}
      {notice ? (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Since</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(members.data?.data ?? []).map((m) => (
                <tr key={m.userId} data-testid="member-row">
                  <Td>
                    {m.name}
                    <div className="text-xs text-slate-500 dark:text-slate-400">{m.email}</div>
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Role of ${m.email}`}
                      value={m.role}
                      disabled={m.userId === user.id}
                      onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                      className="w-44"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>{formatDateTime(m.createdAt)}</Td>
                  <Td className="text-right">
                    {m.userId !== user.id ? (
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.userId)}>
                        Remove
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <h2 className="mb-2 mt-6 text-sm font-semibold">Invitations</h2>
          <ul className="space-y-1 text-sm">
            {(invitations.data?.data ?? []).map((i) => (
              <li
                key={i.id}
                className="flex justify-between rounded border border-slate-200 px-3 py-2 dark:border-slate-800"
              >
                <span>
                  {i.email} · {i.role}
                </span>
                <Badge tone={i.acceptedAt ? 'green' : 'yellow'}>
                  {i.acceptedAt ? 'accepted' : `expires ${formatDateTime(i.expiresAt)}`}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        <Card>
          <CardTitle>Invite a teammate</CardTitle>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email" htmlFor="invite-email">
              <Input id="invite-email" name="email" type="email" required />
            </Field>
            <Field label="Role" htmlFor="invite-role">
              <Select id="invite-role" name="role" defaultValue="catalog_manager">
                {ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>
                    {r.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={invite.isPending} data-testid="send-invite">
              Send invitation
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
