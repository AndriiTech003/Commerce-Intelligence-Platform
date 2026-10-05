'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toApiError } from '@cip/api-client';
import { Button, Card, EmptyState, ErrorNote, Field, Input, Select, Skeleton, formatMoney } from '@cip/ui';
import { api } from '@/lib/browser-api';
import { newIdempotencyKey } from '@/lib/ids';
import {
  clearCheckoutSession,
  getOrCreateCheckoutKey,
  loadPendingOrder,
  rotateCheckoutKey,
  savePendingOrder,
  type PendingOrder,
} from '@/lib/checkout-session';
import {
  EMPTY_FORM,
  loadForm,
  normalizeCard,
  saveForm,
  validateAddress,
  type CheckoutForm,
  type FormErrors,
} from '@/lib/checkout-form';
import { COUNTRIES } from '@/lib/countries';
import { errorCode, errorMessage, stockIssues, type StockIssue } from '@/lib/problem';
import { shippingPrice } from '@/lib/shipping';
import { CART_KEY, useCart } from '@/lib/use-cart';
import type { CheckoutBody } from '@/lib/types';
import { useStore } from './store-context';
import { useCustomer } from './customer-provider';

type Step = 1 | 2 | 3;

type Failure =
  { kind: 'stock'; issues: StockIssue[] } | { kind: 'message'; text: string; cartLink?: boolean };

const STEPS: Array<{ step: Step; label: string }> = [
  { step: 1, label: 'Address' },
  { step: 2, label: 'Shipping' },
  { step: 3, label: 'Payment' },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function CheckoutView() {
  const store = useStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { customer } = useCustomer();
  const { data: cart, isLoading, error: cartError } = useCart();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<CheckoutForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const stored = loadForm(session());
    const methods = store.shippingMethods.map((m) => m.id);
    setForm({
      ...stored,
      shippingMethod: methods.includes(stored.shippingMethod)
        ? stored.shippingMethod
        : (methods[0] ?? 'standard'),
    });
    setPendingOrder(loadPendingOrder(session()));
    setHydrated(true);
  }, [store.shippingMethods]);

  useEffect(() => {
    if (customer?.email)
      setForm((current) => (current.email ? current : { ...current, email: customer.email }));
  }, [customer?.email]);

  useEffect(() => {
    if (hydrated) saveForm(session(), form);
  }, [form, hydrated]);

  const onField = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  if (isLoading || !hydrated) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading checkout">
        <Skeleton className="h-10" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (cartError) return <ErrorNote error={cartError} />;
  if (!cart || (!cart.items.length && !pendingOrder)) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Add something to your cart before checking out."
        action={
          <Link
            href="/"
            className="text-sm font-medium text-[var(--brand)] underline dark:text-[var(--brand-on-dark)]"
          >
            Continue shopping
          </Link>
        }
      />
    );
  }

  const method = store.shippingMethods.find((m) => m.id === form.shippingMethod) ?? store.shippingMethods[0];
  const afterDiscount = Math.max(0, cart.subtotalCents - cart.discountCents);
  const shippingCents = method ? shippingPrice(method, afterDiscount) : 0;
  const totalCents = afterDiscount + shippingCents;
  const isFake = store.paymentProvider === 'fake';

  const body = (): CheckoutBody => ({
    email: form.email.trim(),
    shippingAddress: {
      name: form.name.trim(),
      line1: form.line1.trim(),
      ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
      city: form.city.trim(),
      postalCode: form.postalCode.trim(),
      country: form.country,
    },
    shippingMethod: form.shippingMethod === 'express' ? 'express' : 'standard',
    ...(cart.discountCode ? { discountCode: cart.discountCode } : {}),
  });

  const createOrder = async (): Promise<PendingOrder | null> => {
    const storage = session();
    let key = getOrCreateCheckoutKey(storage, () => newIdempotencyKey());
    let rotated = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await api().POST('/v1/storefront/checkout', {
        params: { header: { 'Idempotency-Key': key } },
        body: body(),
      });
      if (result.data && result.response.ok) {
        const created: PendingOrder = {
          orderId: result.data.orderId,
          intentId: result.data.payment.intentId,
          provider: result.data.payment.provider,
        };
        savePendingOrder(storage, created);
        setPendingOrder(created);
        return created;
      }
      const error = toApiError(result.response.status, result.error);
      const code = errorCode(error);
      if (code === 'IDEMPOTENCY_IN_PROGRESS') {
        const retryAfter = Number(result.response.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 1000);
        continue;
      }
      if (code === 'IDEMPOTENCY_KEY_REUSED' && !rotated) {
        rotated = true;
        rotateCheckoutKey(storage);
        key = getOrCreateCheckoutKey(storage, () => newIdempotencyKey());
        continue;
      }
      if (code === 'INSUFFICIENT_STOCK') {
        rotateCheckoutKey(storage);
        await queryClient.invalidateQueries({ queryKey: CART_KEY });
        setFailure({ kind: 'stock', issues: stockIssues(error) });
        return null;
      }
      if (code === 'CART_EMPTY') {
        rotateCheckoutKey(storage);
        setFailure({ kind: 'message', text: 'Your cart is empty.', cartLink: true });
        return null;
      }
      if (code === 'DISCOUNT_INVALID') {
        rotateCheckoutKey(storage);
        await queryClient.invalidateQueries({ queryKey: CART_KEY });
        setFailure({
          kind: 'message',
          text: `Promo code problem: ${errorMessage(error)}. Remove or change it in your cart.`,
          cartLink: true,
        });
        return null;
      }
      if (error.status >= 400 && error.status < 500) rotateCheckoutKey(storage);
      setFailure({ kind: 'message', text: errorMessage(error) });
      return null;
    }
    setFailure({
      kind: 'message',
      text: 'The order is still being processed. Please try again in a moment.',
    });
    return null;
  };

  const placeOrder = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const order = loadPendingOrder(session()) ?? (await createOrder());
      if (!order) return;
      if (order.provider === 'fake') {
        const confirm = await api().POST('/v1/payments/fake/{intentId}/confirm', {
          params: { path: { intentId: order.intentId } },
          body: { cardNumber: normalizeCard(card) },
        });
        if (!confirm.response.ok) {
          const error = toApiError(confirm.response.status, confirm.error);
          setFailure({
            kind: 'message',
            text: `Payment could not be submitted: ${errorMessage(error)}. Try again.`,
          });
          return;
        }
      }
      clearCheckoutSession(session());
      await queryClient.invalidateQueries({ queryKey: CART_KEY });
      router.push(`/orders/${order.orderId}`);
    } catch (error) {
      setFailure({
        kind: 'message',
        text: `Network error: ${errorMessage(error)}. Your order is safe to retry.`,
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const nextFromAddress = () => {
    const found = validateAddress(form);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(2);
  };

  const titleOf = (variantId: string) =>
    cart.items.find((item) => item.variantId === variantId)?.productTitle ?? 'An item';

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <ol className="flex gap-2 text-sm" aria-label="Checkout steps">
          {STEPS.map(({ step: s, label }) => (
            <li key={s} className="flex-1">
              <button
                type="button"
                disabled={s > step || submitting}
                onClick={() => setStep(s)}
                aria-current={s === step ? 'step' : undefined}
                className={`w-full border-b-2 pb-2 text-left font-medium ${
                  s === step
                    ? 'border-[var(--brand)] text-slate-900 dark:text-white'
                    : s < step
                      ? 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                      : 'border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400'
                }`}
              >
                {s}. {label}
              </button>
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <form
            noValidate
            data-testid="checkout-step-address"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              nextFromAddress();
            }}
          >
            <Field label="Email" htmlFor="email" error={errors.email}>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={onField}
                required
              />
            </Field>
            <Field label="Full name" htmlFor="name" error={errors.name}>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                value={form.name}
                onChange={onField}
                required
              />
            </Field>
            <Field label="Address" htmlFor="line1" error={errors.line1}>
              <Input
                id="line1"
                name="line1"
                autoComplete="address-line1"
                value={form.line1}
                onChange={onField}
                required
              />
            </Field>
            <Field label="Apartment, suite (optional)" htmlFor="line2">
              <Input
                id="line2"
                name="line2"
                autoComplete="address-line2"
                value={form.line2}
                onChange={onField}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City" htmlFor="city" error={errors.city}>
                <Input
                  id="city"
                  name="city"
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={onField}
                  required
                />
              </Field>
              <Field label="Postal code" htmlFor="postalCode" error={errors.postalCode}>
                <Input
                  id="postalCode"
                  name="postalCode"
                  autoComplete="postal-code"
                  value={form.postalCode}
                  onChange={onField}
                  required
                />
              </Field>
              <Field label="Country" htmlFor="country" error={errors.country}>
                <Select
                  id="country"
                  name="country"
                  autoComplete="country"
                  value={form.country}
                  onChange={onField}
                >
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" data-testid="checkout-next" className="h-11 w-full sm:w-auto">
              Continue to shipping
            </Button>
          </form>
        ) : null}

        {step === 2 ? (
          <form
            data-testid="checkout-step-shipping"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setStep(3);
            }}
          >
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Shipping method</legend>
              {store.shippingMethods.map((option) => {
                const price = shippingPrice(option, afterDiscount);
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-sm transition ${
                      form.shippingMethod === option.id
                        ? 'border-[var(--brand)] ring-1 ring-[var(--brand)]'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <input
                      type="radio"
                      name="shippingMethod"
                      value={option.id}
                      data-testid={`shipping-${option.id}`}
                      checked={form.shippingMethod === option.id}
                      onChange={onField}
                      className="accent-[var(--brand)]"
                    />
                    <span className="flex-1">
                      <span className="block font-medium">{option.label}</span>
                      {option.freeOverCents !== null ? (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Free over {formatMoney(option.freeOverCents, store.currency)}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-semibold">
                      {price === 0 ? 'Free' : formatMoney(price, store.currency)}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type="submit" data-testid="checkout-next" className="h-10">
                Continue to payment
              </Button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form
            data-testid="checkout-step-payment"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void placeOrder();
            }}
          >
            <Card className="space-y-1 text-sm">
              <p className="font-medium">Ship to</p>
              <p className="text-slate-600 dark:text-slate-300">
                {form.name}, {form.line1}
                {form.line2 ? `, ${form.line2}` : ''}, {form.city} {form.postalCode}, {form.country}
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                {form.email} · {method?.label}
              </p>
            </Card>
            {isFake ? (
              <Field
                label="Card number"
                htmlFor="card"
                hint="Test cards: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined."
              >
                <Input
                  id="card"
                  name="cardNumber"
                  data-testid="card-number"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  value={card}
                  onChange={(event) => setCard(event.target.value)}
                  placeholder="4242 4242 4242 4242"
                />
              </Field>
            ) : (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                This store uses Stripe. Stripe Elements needs a publishable key
                (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) to collect card details; the order will be created and
                wait for payment confirmation.
              </p>
            )}
            {pendingOrder ? (
              <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="pending-order-note">
                Your order has been created. Submitting again only retries the payment.
              </p>
            ) : null}
            {failure ? (
              <div
                role="alert"
                data-testid="checkout-error"
                className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              >
                {failure.kind === 'stock' ? (
                  <>
                    <p className="font-medium">
                      Some items are no longer available in the requested quantity:
                    </p>
                    <ul className="list-disc pl-5">
                      {failure.issues.length ? (
                        failure.issues.map((issue) => (
                          <li key={issue.variantId}>
                            {titleOf(issue.variantId)}: requested {issue.requested ?? '?'}, available{' '}
                            {issue.available ?? 0}
                          </li>
                        ))
                      ) : (
                        <li>Stock changed while you were checking out.</li>
                      )}
                    </ul>
                    <Link href="/cart" className="font-medium underline">
                      Update your cart
                    </Link>
                  </>
                ) : (
                  <>
                    <p>{failure.text}</p>
                    {failure.cartLink ? (
                      <Link href="/cart" className="font-medium underline">
                        Back to cart
                      </Link>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" disabled={submitting} onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                type="submit"
                data-testid="place-order"
                className="h-11 flex-1"
                loading={submitting}
                disabled={submitting}
              >
                {pendingOrder ? 'Retry payment' : `Place order · ${formatMoney(totalCents, cart.currency)}`}
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      <aside>
        <Card className="space-y-3 text-sm" data-testid="checkout-summary">
          <h2 className="text-base font-semibold">Order summary</h2>
          <ul className="space-y-2">
            {cart.items.map((item) => (
              <li key={item.variantId} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate">{item.productTitle}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {item.variantTitle} × {item.quantity}
                  </span>
                </span>
                <span>{formatMoney(item.lineTotalCents, cart.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatMoney(cart.subtotalCents, cart.currency)}</span>
            </div>
            {cart.discountCents > 0 ? (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Discount {cart.discountCode ? `(${cart.discountCode})` : ''}</span>
                <span>−{formatMoney(cart.discountCents, cart.currency)}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span>Shipping</span>
              <span>
                {step >= 2 ? (shippingCents === 0 ? 'Free' : formatMoney(shippingCents, cart.currency)) : '—'}
              </span>
            </div>
            <div className="flex justify-between pt-1 text-base font-semibold">
              <span>Total</span>
              <span data-testid="checkout-total">{formatMoney(totalCents, cart.currency)}</span>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}
