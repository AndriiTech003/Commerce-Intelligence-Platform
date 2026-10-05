'use client';

import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorNote,
  Field,
  formatDateTime,
  Input,
  Modal,
  Skeleton,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { ProblemNote } from '@/components/problem-note';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';
import type { WebhookDelivery, WebhookEndpoint, WebhookEvent } from '@/lib/types';

const EVENTS: WebhookEvent[] = ['order.paid', 'order.refunded'];

const DELIVERY_TONE = { pending: 'yellow', succeeded: 'green', failed: 'red', dead: 'red' } as const;

const VERIFY_SNIPPET = `const [t, v1] = header.split(',').map((part) => part.split('=')[1]);
const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
const valid = fresh && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));`;

function EventPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: WebhookEvent[];
  onChange: (next: WebhookEvent[]) => void;
  idPrefix: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Events</legend>
      <div className="flex flex-wrap gap-3">
        {EVENTS.map((event) => (
          <label key={event} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(event)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, event] : value.filter((v) => v !== event))
              }
              data-testid={`${idPrefix}-event-${event}`}
            />
            <code>{event}</code>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Deliveries({ endpoint }: { endpoint: WebhookEndpoint }) {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const key = queryKeys.webhooks.deliveries(tenantId, endpoint.id);
  const deliveries = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/webhooks/{id}/deliveries', {
          params: { path: { id: endpoint.id }, query: { limit: 50 } },
        }),
      ),
    refetchInterval: 5000,
  });
  const resend = useMutation({
    mutationFn: async (deliveryId: string) =>
      unwrap(
        await api.POST('/v1/admin/webhooks/deliveries/{deliveryId}/resend', {
          params: { path: { deliveryId } },
        }),
      ),
    onSuccess: (updated: WebhookDelivery) =>
      queryClient.setQueryData<{ data: WebhookDelivery[] }>(key, (old) =>
        old ? { data: old.data.map((d) => (d.id === updated.id ? updated : d)) } : old,
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const rows = deliveries.data?.data ?? [];
  return (
    <Card data-testid="webhook-deliveries">
      <CardTitle>
        Deliveries · <span className="font-mono text-sm font-normal">{endpoint.url}</span>
      </CardTitle>
      <ErrorNote error={deliveries.error} />
      <ProblemNote error={resend.error} />
      {deliveries.isLoading ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No deliveries yet"
          description="Deliveries appear when a subscribed event happens."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Status</Th>
              <Th className="text-right">Attempts</Th>
              <Th>Last response</Th>
              <Th>Next attempt</Th>
              <Th className="text-right">Duration</Th>
              <Th>Created</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((d) => (
              <Fragment key={d.id}>
                <tr data-testid="delivery-row" data-status={d.status}>
                  <Td>
                    <code className="text-xs">{d.eventType}</code>
                  </Td>
                  <Td>
                    <Badge tone={DELIVERY_TONE[d.status]}>{d.status}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{d.attempts}</Td>
                  <Td className="max-w-xs text-xs">
                    {d.lastStatusCode !== null ? (
                      <span className="font-mono">HTTP {d.lastStatusCode}</span>
                    ) : null}
                    {d.lastError ? (
                      <span className="block truncate text-red-700 dark:text-red-300">{d.lastError}</span>
                    ) : null}
                    {d.lastStatusCode === null && !d.lastError ? '—' : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(d.nextAttemptAt)}</Td>
                  <Td className="text-right tabular-nums text-xs">
                    {d.durationMs !== null ? `${d.durationMs} ms` : '—'}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(d.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={open === d.id}
                      onClick={() => setOpen(open === d.id ? null : d.id)}
                    >
                      Payload
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => resend.mutate(d.id)}
                      disabled={resend.isPending && resend.variables === d.id}
                      data-testid="resend-delivery"
                    >
                      Resend
                    </Button>
                  </Td>
                </tr>
                {open === d.id ? (
                  <tr>
                    <Td colSpan={8}>
                      <pre className="max-h-72 overflow-auto rounded bg-slate-50 p-2 text-xs dark:bg-slate-950">
                        {JSON.stringify(d.payload, null, 2)}
                      </pre>
                    </Td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export default function WebhooksPage() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const listKey = queryKeys.webhooks.list(tenantId);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['order.paid']);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editEvents, setEditEvents] = useState<WebhookEvent[]>([]);
  const [editDescription, setEditDescription] = useState('');
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);

  const endpoints = useQuery({
    queryKey: listKey,
    queryFn: async () => unwrap(await api.GET('/v1/admin/webhooks')),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all(tenantId) });

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/webhooks', {
          body: {
            url: url.trim(),
            events,
            ...(description.trim() ? { description: description.trim() } : {}),
          },
        }),
      ),
    onSuccess: (created) => {
      setSecret(created.secret);
      setCopied(false);
      setUrl('');
      setDescription('');
      setSelected(created.id);
      refresh();
    },
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      body: {
        url?: string;
        events?: WebhookEvent[];
        status?: 'active' | 'disabled';
        description?: string | null;
      };
    }) =>
      unwrap(
        await api.PATCH('/v1/admin/webhooks/{id}', { params: { path: { id: input.id } }, body: input.body }),
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<{ data: WebhookEndpoint[] }>(listKey);
      queryClient.setQueryData<{ data: WebhookEndpoint[] }>(listKey, (old) =>
        old
          ? {
              data: old.data.map((e) =>
                e.id === input.id
                  ? {
                      ...e,
                      ...(input.body.url !== undefined ? { url: input.body.url } : {}),
                      ...(input.body.events !== undefined ? { events: input.body.events } : {}),
                      ...(input.body.status !== undefined ? { status: input.body.status } : {}),
                      ...(input.body.description !== undefined
                        ? { description: input.body.description }
                        : {}),
                    }
                  : e,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _input, context) => queryClient.setQueryData(listKey, context?.previous),
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.DELETE('/v1/admin/webhooks/{id}', { params: { path: { id } } });
      if (!result.response.ok) unwrap(result);
    },
    onSuccess: (_data, id) => {
      setDeleting(null);
      if (selected === id) setSelected(null);
    },
    onSettled: refresh,
  });

  const startEdit = (endpoint: WebhookEndpoint) => {
    setEditing(endpoint);
    setEditUrl(endpoint.url);
    setEditEvents(endpoint.events);
    setEditDescription(endpoint.description ?? '');
    update.reset();
  };

  const rows = endpoints.data?.data ?? [];
  const selectedEndpoint = rows.find((e) => e.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Webhooks"
        description="Signed HTTP callbacks for order events, retried with exponential backoff (1m, 5m, 30m, 2h, 12h) before an endpoint is disabled."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ErrorNote error={endpoints.error} />
          <ProblemNote error={update.error && !editing ? update.error : null} />
          {endpoints.isLoading ? (
            <Skeleton className="h-40" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No endpoints yet"
              description="Add a URL to receive order.paid and order.refunded events."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Endpoint</Th>
                  <Th>Events</Th>
                  <Th>Status</Th>
                  <Th>Last delivery</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    data-testid="webhook-row"
                    className={selected === e.id ? 'bg-slate-50 dark:bg-slate-800/50' : undefined}
                  >
                    <Td className="max-w-xs">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-mono text-xs hover:underline"
                        onClick={() => setSelected(e.id)}
                        aria-pressed={selected === e.id}
                      >
                        {e.url}
                      </button>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        secret {e.secretPrefix}… {e.description ? `· ${e.description}` : ''}
                      </span>
                    </Td>
                    <Td className="text-xs">{e.events.join(', ')}</Td>
                    <Td>
                      <Badge tone={e.status === 'active' ? 'green' : 'red'}>{e.status}</Badge>
                      {e.disabledAt ? (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          since {formatDateTime(e.disabledAt)}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(e.lastDeliveryAt)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(e.id)}>
                        Deliveries
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(e)}
                        data-testid="webhook-edit"
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          update.mutate({
                            id: e.id,
                            body: { status: e.status === 'active' ? 'disabled' : 'active' },
                          })
                        }
                        data-testid="webhook-toggle"
                      >
                        {e.status === 'active' ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(e)}
                        data-testid="webhook-delete"
                      >
                        Delete
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {selectedEndpoint ? <Deliveries key={selectedEndpoint.id} endpoint={selectedEndpoint} /> : null}
        </div>
        <div className="space-y-4">
          <Card>
            <CardTitle>Add endpoint</CardTitle>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <Field label="URL" htmlFor="webhook-url" hint="HTTPS in production">
                <Input
                  id="webhook-url"
                  type="url"
                  required
                  placeholder="https://example.com/hooks/cip"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  data-testid="new-webhook-url"
                />
              </Field>
              <Field label="Description" htmlFor="webhook-description">
                <Input
                  id="webhook-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <EventPicker value={events} onChange={setEvents} idPrefix="new-webhook" />
              <ProblemNote error={create.error} testId="webhook-create-error" />
              <Button
                type="submit"
                loading={create.isPending}
                disabled={!url.trim() || events.length === 0}
                data-testid="create-webhook"
              >
                Add endpoint
              </Button>
            </form>
          </Card>
          <Card data-testid="webhook-signature-doc">
            <CardTitle>Verifying signatures</CardTitle>
            <p className="text-sm">Every request carries:</p>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs dark:bg-slate-950">
              X-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;
            </pre>
            <p className="mt-2 text-sm">
              where <code>v1 = HMAC_SHA256(secret, t + &apos;.&apos; + body)</code> over the raw request body.
              Reject requests whose <code>t</code> is older than 5 minutes to block replays, and compare in
              constant time:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs dark:bg-slate-950">
              {VERIFY_SNIPPET}
            </pre>
          </Card>
        </div>
      </div>
      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="Signing secret"
        footer={<Button onClick={() => setSecret(null)}>Done</Button>}
      >
        <p>Copy this secret now. It is shown only once; only a prefix is stored for display.</p>
        <div className="flex items-center gap-2">
          <code
            className="block flex-1 break-all rounded bg-slate-100 p-2 text-sm dark:bg-slate-800"
            data-testid="webhook-secret"
          >
            {secret}
          </code>
          <Button
            variant="secondary"
            size="sm"
            data-testid="copy-secret"
            onClick={() => {
              if (!secret) return;
              void navigator.clipboard
                .writeText(secret)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Modal>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit endpoint"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={update.isPending}
              disabled={!editUrl.trim() || editEvents.length === 0}
              onClick={() =>
                editing &&
                update.mutate({
                  id: editing.id,
                  body: {
                    url: editUrl.trim(),
                    events: editEvents,
                    description: editDescription.trim() || null,
                  },
                })
              }
              data-testid="save-webhook"
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="URL" htmlFor="edit-webhook-url">
          <Input
            id="edit-webhook-url"
            type="url"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
          />
        </Field>
        <Field label="Description" htmlFor="edit-webhook-description">
          <Input
            id="edit-webhook-description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
          />
        </Field>
        <EventPicker value={editEvents} onChange={setEditEvents} idPrefix="edit-webhook" />
        <ProblemNote error={editing ? update.error : null} />
      </Modal>
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete endpoint?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
              data-testid="confirm-delete-webhook"
            >
              Delete
            </Button>
          </>
        }
      >
        <p>
          Pending deliveries to <code className="break-all">{deleting?.url}</code> will be dropped.
        </p>
        <ProblemNote error={remove.error} />
      </Modal>
    </div>
  );
}
