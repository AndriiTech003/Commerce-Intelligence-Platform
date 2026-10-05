'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { unwrap } from '@cip/api-client';
import { Badge, Card, ErrorNote, Skeleton, Spinner, formatDateTime, formatMoney, statusTone } from '@cip/ui';
import { api } from '@/lib/browser-api';
import { nextPollDelay, shouldKeepPolling } from '@/lib/backoff';
import type { PublicOrder } from '@/lib/types';

async function fetchOrder(id: string, signal: AbortSignal): Promise<PublicOrder> {
  return unwrap(await api().GET('/v1/storefront/orders/{id}', { params: { path: { id } }, signal }));
}

const HEADLINES: Record<string, string> = {
  pending_payment: 'Waiting for payment confirmation…',
  paid: 'Payment received — thank you!',
  fulfilled: 'Your order is on its way',
  delivered: 'Your order was delivered',
  payment_failed: 'Payment failed',
  cancelled: 'Order cancelled',
  refunded: 'Order refunded',
};

export function OrderStatusView({ id }: { id: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay: number | null = null;
    const started = Date.now();
    const tick = async () => {
      try {
        const next = await fetchOrder(id, controller.signal);
        if (controller.signal.aborted) return;
        setOrder(next);
        setError(null);
        if (shouldKeepPolling(next.status, Date.now() - started)) {
          delay = nextPollDelay(delay);
          timer = setTimeout(() => void tick(), delay);
        } else if (next.status === 'pending_payment') setTimedOut(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err);
        if (Date.now() - started < 60000) {
          delay = nextPollDelay(delay);
          timer = setTimeout(() => void tick(), delay);
        }
      }
    };
    void tick();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (!order) {
    return error ? (
      <ErrorNote error={error} />
    ) : (
      <div className="space-y-3" role="status" aria-label="Loading order">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const failed = order.status === 'payment_failed' || order.status === 'cancelled';
  const pending = order.status === 'pending_payment';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2 text-center">
        <div className="flex justify-center">
          {pending ? (
            <Spinner className="h-8 w-8 text-[var(--brand)]" />
          ) : failed ? (
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-xl text-red-700"
              aria-hidden="true"
            >
              ×
            </span>
          ) : (
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700"
              aria-hidden="true"
            >
              ✓
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight" aria-live="polite">
          {HEADLINES[order.status] ?? 'Order status'}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Order{' '}
          <span data-testid="order-number" className="font-semibold text-slate-800 dark:text-slate-200">
            {order.number}
          </span>
          {' · '}
          {formatDateTime(order.placedAt)}
        </p>
        <div className="flex justify-center">
          <Badge tone={statusTone(order.status)}>
            <span data-testid="order-status">{order.status}</span>
          </Badge>
        </div>
        {pending && timedOut ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This is taking longer than usual. We&apos;ll email {order.email} once the payment is confirmed.
          </p>
        ) : null}
        {failed ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {order.status === 'payment_failed'
              ? 'Your card was declined. No money was taken — please try another card.'
              : 'This order was cancelled.'}{' '}
            <Link href="/cart" className="font-medium underline">
              Back to cart
            </Link>
          </p>
        ) : null}
        {error ? <p className="text-xs text-slate-500 dark:text-slate-400">Reconnecting…</p> : null}
      </div>

      <Card className="space-y-3 text-sm">
        <h2 className="text-base font-semibold">Items</h2>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="order-items">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-2">
              <span>
                {item.title} <span className="text-slate-500 dark:text-slate-400">× {item.quantity}</span>
              </span>
              <span>{formatMoney(item.unitPriceCents * item.quantity, order.currency)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatMoney(order.subtotalCents, order.currency)}</dd>
          </div>
          {order.discountCents > 0 ? (
            <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
              <dt>Discount</dt>
              <dd>−{formatMoney(order.discountCents, order.currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt>Shipping</dt>
            <dd>{order.shippingCents === 0 ? 'Free' : formatMoney(order.shippingCents, order.currency)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd data-testid="order-total">{formatMoney(order.totalCents, order.currency)}</dd>
          </div>
        </dl>
      </Card>
      <div className="text-center">
        <Link
          href="/"
          className="text-sm font-medium text-[var(--brand)] underline dark:text-[var(--brand-on-dark)]"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
