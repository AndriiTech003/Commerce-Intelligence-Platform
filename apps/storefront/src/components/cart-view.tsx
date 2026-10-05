'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@cip/api-client';
import { Button, Card, EmptyState, ErrorNote, Input, ProductImage, Skeleton, formatMoney } from '@cip/ui';
import { api } from '@/lib/browser-api';
import { errorCode, errorMessage, stockIssues } from '@/lib/problem';
import { CART_KEY, useCart } from '@/lib/use-cart';
import type { Cart, CartItem } from '@/lib/types';
import { useTracker } from './tracker-provider';
import { PersonalizedCampaign } from './personalization/personalized-campaign';
import { RecommendationsSection } from './personalization/recommendations-section';

function withQuantity(cart: Cart, variantId: string, quantity: number): Cart {
  const items = cart.items
    .map((item) =>
      item.variantId === variantId
        ? { ...item, quantity, lineTotalCents: item.unitPriceCents * quantity }
        : item,
    )
    .filter((item) => item.quantity > 0);
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  return {
    ...cart,
    items,
    itemsCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents,
    totalCents: Math.max(0, subtotalCents - cart.discountCents),
  };
}

export function CartView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tracker = useTracker();
  const { data: cart, isLoading, error: loadError, refetch } = useCart();
  const [lineError, setLineError] = useState<{ variantId: string; text: string } | null>(null);
  const [code, setCode] = useState('');
  const [promoError, setPromoError] = useState<string | null>(null);

  const optimistic = async (variantId: string, quantity: number) => {
    await queryClient.cancelQueries({ queryKey: CART_KEY });
    const previous = queryClient.getQueryData<Cart>(CART_KEY);
    if (previous) queryClient.setQueryData<Cart>(CART_KEY, withQuantity(previous, variantId, quantity));
    return { previous };
  };

  const update = useMutation({
    mutationFn: async (input: { variantId: string; quantity: number }) =>
      unwrap(
        await api().PATCH('/v1/storefront/cart/items/{variantId}', {
          params: { path: { variantId: input.variantId } },
          body: { quantity: input.quantity },
        }),
      ),
    onMutate: (input) => {
      setLineError(null);
      return optimistic(input.variantId, input.quantity);
    },
    onError: (error, input, context) => {
      if (context?.previous) queryClient.setQueryData(CART_KEY, context.previous);
      const issue = stockIssues(error)[0];
      setLineError({
        variantId: input.variantId,
        text:
          errorCode(error) === 'INSUFFICIENT_STOCK'
            ? `Only ${issue?.available ?? 'a limited number'} available.`
            : `Could not update quantity: ${errorMessage(error)}`,
      });
    },
    onSuccess: (next) => queryClient.setQueryData(CART_KEY, next),
  });

  const remove = useMutation({
    mutationFn: async (item: CartItem) =>
      unwrap(
        await api().DELETE('/v1/storefront/cart/items/{variantId}', {
          params: { path: { variantId: item.variantId } },
        }),
      ),
    onMutate: (item) => {
      setLineError(null);
      return optimistic(item.variantId, 0);
    },
    onError: (error, item, context) => {
      if (context?.previous) queryClient.setQueryData(CART_KEY, context.previous);
      setLineError({ variantId: item.variantId, text: `Could not remove item: ${errorMessage(error)}` });
    },
    onSuccess: (next, item) => {
      queryClient.setQueryData(CART_KEY, next);
      tracker.track('cart_item_removed', {
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantity,
        ...(item.categoryPath ? { category_path: item.categoryPath } : {}),
      });
    },
  });

  const applyDiscount = useMutation({
    mutationFn: async (value: string) =>
      unwrap(await api().POST('/v1/storefront/cart/discount', { body: { code: value } })),
    onMutate: () => setPromoError(null),
    onSuccess: (next) => {
      queryClient.setQueryData(CART_KEY, next);
      setCode('');
      if (next.discountError) setPromoError(next.discountError);
    },
    onError: (error) => setPromoError(errorMessage(error)),
  });

  const removeDiscount = useMutation({
    mutationFn: async () => unwrap(await api().DELETE('/v1/storefront/cart/discount')),
    onSuccess: (next) => {
      queryClient.setQueryData(CART_KEY, next);
      setPromoError(null);
    },
    onError: (error) => setPromoError(errorMessage(error)),
  });

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading cart">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (loadError || !cart) {
    return (
      <div className="space-y-3">
        <ErrorNote error={loadError ?? new Error('Cart unavailable')} />
        <Button variant="secondary" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!cart.items.length) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Browse the catalog and add something you like."
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

  const discountProblem = promoError ?? cart.discountError;
  const unavailable = cart.items.some((item) => item.available < item.quantity);
  const inCart = cart.items.map((item) => item.productId);
  const cartKey = [...new Set(inCart)].sort().join(',');

  return (
    <div className="space-y-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <ul className="space-y-3" aria-label="Cart items">
          {cart.items.map((item) => {
            const max = Math.max(item.available, item.quantity);
            return (
              <li key={item.variantId} data-testid="cart-item" data-variant-id={item.variantId}>
                <Card className="flex gap-4">
                  <Link
                    href={`/p/${item.productSlug}`}
                    className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:h-24 sm:w-24"
                  >
                    <ProductImage src={item.imageUrl} alt={item.productTitle} />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/p/${item.productSlug}`} className="font-medium hover:underline">
                          {item.productTitle}
                        </Link>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {item.variantTitle} · {item.sku}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold" data-testid="line-total">
                        {formatMoney(item.lineTotalCents, cart.currency)}
                      </span>
                    </div>
                    {item.priceChanged && item.previousUnitPriceCents !== null ? (
                      <p
                        data-testid="price-changed"
                        className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      >
                        Price changed: {formatMoney(item.previousUnitPriceCents, cart.currency)} →{' '}
                        {formatMoney(item.unitPriceCents, cart.currency)}
                      </p>
                    ) : null}
                    {item.available < item.quantity ? (
                      <p className="text-xs text-red-600 dark:text-red-400" data-testid="stock-warning">
                        Only {item.available} available — please reduce the quantity.
                      </p>
                    ) : null}
                    <div className="mt-auto flex flex-wrap items-center gap-3">
                      <div className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-700">
                        <button
                          type="button"
                          data-testid="qty-decrease"
                          aria-label={`Decrease quantity of ${item.productTitle}`}
                          disabled={item.quantity <= 1}
                          onClick={() =>
                            update.mutate({ variantId: item.variantId, quantity: item.quantity - 1 })
                          }
                          className="h-8 w-8 text-lg leading-none disabled:opacity-40"
                        >
                          −
                        </button>
                        <span
                          className="w-8 text-center text-sm tabular-nums"
                          data-testid="line-quantity"
                          aria-live="polite"
                        >
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          data-testid="qty-increase"
                          aria-label={`Increase quantity of ${item.productTitle}`}
                          disabled={item.quantity >= max}
                          onClick={() =>
                            update.mutate({ variantId: item.variantId, quantity: item.quantity + 1 })
                          }
                          className="h-8 w-8 text-lg leading-none disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {formatMoney(item.unitPriceCents, cart.currency)} each
                      </span>
                      <button
                        type="button"
                        data-testid="remove-item"
                        onClick={() => remove.mutate(item)}
                        className="ml-auto text-sm text-slate-500 dark:text-slate-400 underline hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                    {lineError?.variantId === item.variantId ? (
                      <p
                        role="alert"
                        className="text-xs text-red-600 dark:text-red-400"
                        data-testid="line-error"
                      >
                        {lineError.text}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>

        <aside className="space-y-4">
          <Card className="space-y-3">
            <h2 className="text-base font-semibold">Promo code</h2>
            {cart.discountCode ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  Applied: <strong data-testid="discount-code">{cart.discountCode}</strong>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={removeDiscount.isPending}
                  onClick={() => removeDiscount.mutate()}
                >
                  Remove
                </Button>
              </div>
            ) : null}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const value = code.trim();
                if (value) applyDiscount.mutate(value);
              }}
            >
              <label htmlFor="promo" className="sr-only">
                Promo code
              </label>
              <Input
                id="promo"
                data-testid="promo-input"
                placeholder="Enter code"
                value={code}
                autoComplete="off"
                onChange={(event) => setCode(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                data-testid="promo-apply"
                loading={applyDiscount.isPending}
              >
                Apply
              </Button>
            </form>
            {discountProblem ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400" data-testid="promo-error">
                {discountProblem}
              </p>
            ) : null}
          </Card>
          <Card className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal ({cart.itemsCount} items)</span>
              <span data-testid="cart-subtotal">{formatMoney(cart.subtotalCents, cart.currency)}</span>
            </div>
            {cart.discountCents > 0 ? (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Discount</span>
                <span data-testid="cart-discount">−{formatMoney(cart.discountCents, cart.currency)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Shipping</span>
              <span>Calculated at checkout</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-800">
              <span>Total</span>
              <span data-testid="cart-total">{formatMoney(cart.totalCents, cart.currency)}</span>
            </div>
            <Button
              className="mt-2 h-11 w-full"
              data-testid="checkout-button"
              disabled={unavailable || update.isPending || remove.isPending}
              onClick={() => {
                if (cart.id) {
                  tracker.track('checkout_started', {
                    cart_id: cart.id,
                    value_cents: cart.totalCents,
                    items_count: cart.itemsCount,
                  });
                }
                router.push('/checkout');
              }}
            >
              Checkout
            </Button>
          </Card>
          <PersonalizedCampaign placement="cart_upsell" refreshKey={cartKey} />
        </aside>
      </div>
      <RecommendationsSection
        type="cart_upsell"
        title="Complete your order"
        testId="recommendations-cart-upsell"
        limit={12}
        show={4}
        exclude={inCart}
        refreshKey={cartKey}
      />
    </div>
  );
}
