'use client';

import { manualTransitions, type OrderStatus } from '@cip/contracts';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorNote,
  Field,
  formatDateTime,
  formatMoney,
  Input,
  Modal,
  Skeleton,
  statusTone,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { PageHeader } from '@/components/shell';
import { api, errorMessage, newIdempotencyKey, unwrap } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useSession, useTenantId } from '@/lib/session';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState('');
  const refundKey = useRef<string | null>(null);
  const order = useQuery({
    queryKey: queryKeys.orders.detail(tenantId, id),
    queryFn: async () => unwrap(await api.GET('/v1/admin/orders/{id}', { params: { path: { id } } })),
    refetchInterval: (query) => (query.state.data?.status === 'pending_payment' ? 3000 : false),
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all(tenantId) });
  };
  const transition = useMutation({
    mutationFn: async (to: OrderStatus) =>
      unwrap(await api.POST('/v1/admin/orders/{id}/transitions', { params: { path: { id } }, body: { to } })),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.orders.detail(tenantId, id), data);
      invalidate();
    },
  });
  const refund = useMutation({
    mutationFn: async () => {
      refundKey.current ??= newIdempotencyKey();
      return unwrap(
        await api.POST('/v1/admin/orders/{id}/refund', {
          params: { path: { id }, header: { 'Idempotency-Key': refundKey.current } },
          body: reason ? { reason } : {},
        }),
      );
    },
    onSuccess: () => {
      refundKey.current = null;
      setRefundOpen(false);
      invalidate();
      void order.refetch();
    },
  });

  if (order.error) return <ErrorNote error={order.error} />;
  const o = order.data;
  if (!o) return <Skeleton className="h-96" />;
  const allowed = manualTransitions(o.status);

  return (
    <div>
      <PageHeader
        title={`Order #${o.number}`}
        description={`${o.email} · ${formatDateTime(o.placedAt)}`}
        actions={
          <>
            <Badge tone={statusTone(o.status)} className="self-center text-sm">
              <span data-testid="order-detail-status">{o.status}</span>
            </Badge>
            {can('orders:manage')
              ? allowed.map((to) => (
                  <Button
                    key={to}
                    variant={to === 'cancelled' ? 'secondary' : 'primary'}
                    loading={transition.isPending && transition.variables === to}
                    onClick={() => transition.mutate(to)}
                    data-testid={`transition-${to}`}
                  >
                    Mark {to}
                  </Button>
                ))
              : null}
            {can('orders:manage') && o.refundable ? (
              <Button variant="danger" onClick={() => setRefundOpen(true)} data-testid="refund">
                Refund
              </Button>
            ) : null}
          </>
        }
      />
      {transition.error ? <ErrorNote error={new Error(errorMessage(transition.error))} /> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardTitle>Items</CardTitle>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Price</Th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((item) => (
                  <tr key={item.id}>
                    <Td>{item.title}</Td>
                    <Td>{item.sku}</Td>
                    <Td className="text-right">{item.quantity}</Td>
                    <Td className="text-right">
                      {formatMoney(item.unitPriceCents * item.quantity, o.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
              <dt className="text-slate-500 dark:text-slate-400">Subtotal</dt>
              <dd className="text-right">{formatMoney(o.subtotalCents, o.currency)}</dd>
              <dt className="text-slate-500 dark:text-slate-400">
                Discount {o.discountCode ? `(${o.discountCode})` : ''}
              </dt>
              <dd className="text-right">−{formatMoney(o.discountCents, o.currency)}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Shipping</dt>
              <dd className="text-right">{formatMoney(o.shippingCents, o.currency)}</dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">{formatMoney(o.totalCents, o.currency)}</dd>
            </dl>
          </Card>
          <Card>
            <CardTitle>Payments</CardTitle>
            {o.payments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No payment yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span>
                      {p.provider} · {p.providerRef}
                    </span>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardTitle>Timeline</CardTitle>
            <ol
              className="space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700"
              data-testid="order-timeline"
            >
              {o.history.map((h) => (
                <li key={h.id} className="text-sm">
                  <div className="font-medium">{h.toStatus.replace('_', ' ')}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDateTime(h.createdAt)}
                    {h.reason ? ` · ${h.reason}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardTitle>Shipping address</CardTitle>
            <pre className="whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">
              {JSON.stringify(o.shippingAddress, null, 2)}
            </pre>
          </Card>
          <Card>
            <CardTitle>Attribution</CardTitle>
            {o.attribution ? (
              <dl className="space-y-1 text-sm" data-testid="order-attribution">
                {Object.entries(o.attribution).map(([key, value]) => {
                  const text = typeof value === 'string' ? value : JSON.stringify(value);
                  const href =
                    key === 'decisionId'
                      ? `/marketing/decisions/${text}`
                      : key === 'campaignId'
                        ? `/marketing/campaigns/${text}`
                        : null;
                  return (
                    <div key={key} className="flex justify-between gap-3">
                      <dt className="text-slate-500 dark:text-slate-400">{key}</dt>
                      <dd className="truncate font-mono text-xs">
                        {href ? (
                          <Link
                            href={href}
                            className="text-[var(--brand,#2563eb)] hover:underline dark:text-blue-400"
                          >
                            {key === 'decisionId' ? 'Why this ad?' : text.slice(0, 8)}
                          </Link>
                        ) : (
                          text
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No campaign attribution for this order.
              </p>
            )}
          </Card>
        </div>
      </div>
      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title={`Refund order #${o.number}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={refund.isPending}
              onClick={() => refund.mutate()}
              data-testid="confirm-refund"
            >
              Refund {formatMoney(o.totalCents, o.currency)}
            </Button>
          </>
        }
      >
        <p>This refunds the full amount and returns the items to stock.</p>
        <Field label="Reason" htmlFor="reason">
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {refund.error ? <ErrorNote error={new Error(errorMessage(refund.error))} /> : null}
      </Modal>
    </div>
  );
}
