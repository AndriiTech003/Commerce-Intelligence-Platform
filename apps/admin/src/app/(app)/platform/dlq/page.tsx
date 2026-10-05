'use client';

import { Badge, Button, Card, CardTitle, EmptyState, ErrorNote } from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/shell';
import { api, errorMessage, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export default function DlqPage() {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const queues = useQuery({
    queryKey: queryKeys.platform.dlq(),
    queryFn: async () => unwrap(await api.GET('/v1/platform/dlq')),
    refetchInterval: 5000,
  });
  const messages = useQuery({
    queryKey: queryKeys.platform.dlqMessages(queue ?? ''),
    enabled: queue !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/platform/dlq/{queue}/messages', {
          params: { path: { queue: queue! }, query: { limit: 50 } },
        }),
      ),
  });
  const replay = useMutation({
    mutationFn: async (ids: string[] | 'all') =>
      unwrap(
        await api.POST('/v1/platform/dlq/{queue}/replay', {
          params: { path: { queue: queue! } },
          body: { messageIds: ids },
        }),
      ),
    onSuccess: () => {
      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ['platform', 'dlq'] });
    },
  });
  return (
    <div>
      <PageHeader
        title="Dead-letter queues"
        description="Messages that exhausted retries or were classified as poison. Replay moves them back to the source queue."
      />
      <ErrorNote error={queues.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>Queues</CardTitle>
          <ul className="space-y-1" data-testid="dlq-list">
            {(queues.data?.data ?? []).map((q) => (
              <li key={q.queue}>
                <button
                  type="button"
                  className={`flex w-full justify-between rounded px-2 py-1.5 text-left text-sm ${queue === q.queue ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                  onClick={() => setQueue(q.queue)}
                >
                  <span className="font-mono text-xs">{q.queue}</span>
                  <Badge tone={q.messages > 0 ? 'red' : 'neutral'}>{q.messages}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="lg:col-span-2">
          {queue === null ? (
            <EmptyState title="Select a queue" />
          ) : (
            <Card>
              <CardTitle
                actions={
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={selected.length === 0}
                      loading={replay.isPending}
                      onClick={() => replay.mutate(selected)}
                    >
                      Replay selected
                    </Button>
                    <Button
                      size="sm"
                      loading={replay.isPending}
                      onClick={() => replay.mutate('all')}
                      data-testid="replay-all"
                    >
                      Replay all
                    </Button>
                  </div>
                }
              >
                {queue}
              </CardTitle>
              {replay.error ? <ErrorNote error={new Error(errorMessage(replay.error))} /> : null}
              {replay.data ? (
                <p className="mb-2 text-sm text-emerald-700">
                  Replayed {replay.data.replayed}, remaining {replay.data.remaining}.
                </p>
              ) : null}
              {(messages.data?.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Queue is empty.</p>
              ) : (
                <ul className="space-y-3">
                  {(messages.data?.data ?? []).map((m) => (
                    <li
                      key={m.messageId}
                      className="rounded border border-slate-200 p-3 text-xs dark:border-slate-800"
                    >
                      <label className="flex items-center gap-2 font-mono">
                        <input
                          type="checkbox"
                          checked={selected.includes(m.messageId)}
                          onChange={(e) =>
                            setSelected((s) =>
                              e.target.checked ? [...s, m.messageId] : s.filter((x) => x !== m.messageId),
                            )
                          }
                        />
                        {m.messageId} · {m.routingKey} · retries {m.retryCount}
                      </label>
                      {m.error ? <p className="mt-1 text-red-600 dark:text-red-400">{m.error}</p> : null}
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-50 p-2 dark:bg-slate-950">
                        {JSON.stringify(m.body, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
