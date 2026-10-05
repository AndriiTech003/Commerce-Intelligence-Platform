'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@cip/api-client';
import { Button, Select, formatMoney } from '@cip/ui';
import { api } from '@/lib/browser-api';
import { errorCode, errorMessage, stockIssues } from '@/lib/problem';
import { CART_KEY } from '@/lib/use-cart';
import type { ProductDetail } from '@/lib/types';
import { useTracker } from './tracker-provider';

function variantLabel(attributes: Record<string, string>, fallback: string): string {
  const values = Object.values(attributes).filter(Boolean);
  return values.length ? values.join(' / ') : fallback;
}

export function ProductPurchase({ product }: { product: ProductDetail }) {
  const tracker = useTracker();
  const queryClient = useQueryClient();
  const firstAvailable = product.variants.find((v) => v.available > 0) ?? product.variants[0];
  const [variantId, setVariantId] = useState(firstAvailable?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const variant = useMemo(
    () => product.variants.find((v) => v.id === variantId) ?? firstAvailable,
    [product.variants, variantId, firstAvailable],
  );
  const viewed = useRef<string | null>(null);
  const categoryPath = product.categoryPath ?? '';

  useEffect(() => {
    if (viewed.current === product.id) return;
    viewed.current = product.id;
    tracker.track('page_viewed', { page_type: 'product' });
    tracker.track('product_viewed', {
      product_id: product.id,
      ...(variant ? { variant_id: variant.id } : {}),
      category_path: categoryPath,
      price_cents: variant?.priceCents ?? product.priceMinCents ?? 0,
      ...(product.brand ? { brand: product.brand } : {}),
      title: product.title,
    });
  }, [tracker, product, variant, categoryPath]);

  const add = useMutation({
    mutationFn: async (input: { variantId: string; quantity: number }) =>
      unwrap(await api().POST('/v1/storefront/cart/items', { body: input })),
    onSuccess: (cart, input) => {
      queryClient.setQueryData(CART_KEY, cart);
      setMessage({ tone: 'ok', text: `Added ${input.quantity} to your cart.` });
      tracker.track('cart_item_added', {
        product_id: product.id,
        variant_id: input.variantId,
        quantity: input.quantity,
        price_cents:
          product.variants.find((v) => v.id === input.variantId)?.priceCents ??
          variant?.priceCents ??
          product.priceMinCents ??
          0,
        category_path: categoryPath,
        ...(product.brand ? { brand: product.brand } : {}),
        title: product.title,
      });
    },
    onError: (error) => {
      if (errorCode(error) === 'INSUFFICIENT_STOCK') {
        const issue = stockIssues(error)[0];
        const available = issue?.available ?? variant?.available ?? 0;
        setMessage({
          tone: 'error',
          text:
            available > 0
              ? `Only ${available} available — some may already be in your cart.`
              : 'This item is out of stock.',
        });
      } else setMessage({ tone: 'error', text: errorMessage(error) });
    },
  });

  if (!variant)
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">This product is currently unavailable.</p>
    );

  const onSale = variant.compareAtCents !== null && variant.compareAtCents > variant.priceCents;
  const inStock = variant.available > 0;
  const maxQty = Math.max(1, Math.min(variant.available, 20));

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3" data-testid="product-price">
        <span className="text-2xl font-semibold">{formatMoney(variant.priceCents, variant.currency)}</span>
        {onSale ? (
          <span className="text-base text-slate-500 dark:text-slate-400 line-through">
            {formatMoney(variant.compareAtCents, variant.currency)}
          </span>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="variant" className="text-sm font-medium">
          Option
        </label>
        <Select
          id="variant"
          data-testid="variant-select"
          value={variant.id}
          onChange={(event) => {
            setVariantId(event.target.value);
            setQuantity(1);
            setMessage(null);
          }}
        >
          {product.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {variantLabel(v.attributes, v.title)} — {formatMoney(v.priceCents, v.currency)}
              {v.available > 0 ? '' : ' (sold out)'}
            </option>
          ))}
        </Select>
      </div>

      <p
        data-testid="availability"
        className={`text-sm font-medium ${inStock ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}
      >
        {inStock
          ? variant.available <= 5
            ? `Only ${variant.available} left in stock`
            : 'In stock'
          : 'Out of stock'}
      </p>

      <div className="flex items-end gap-3">
        <div className="w-24 space-y-1">
          <label htmlFor="quantity" className="text-sm font-medium">
            Quantity
          </label>
          <Select
            id="quantity"
            data-testid="quantity-select"
            value={quantity}
            disabled={!inStock}
            onChange={(event) => setQuantity(Number(event.target.value))}
          >
            {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <Button
          data-testid="add-to-cart"
          className="h-10 flex-1"
          disabled={!inStock}
          loading={add.isPending}
          onClick={() => {
            setMessage(null);
            add.mutate({ variantId: variant.id, quantity });
          }}
        >
          {inStock ? 'Add to cart' : 'Sold out'}
        </Button>
      </div>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          data-testid="add-to-cart-message"
          className={`text-sm ${message.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}
        >
          {message.text}{' '}
          {message.tone === 'ok' ? (
            <Link href="/cart" className="font-medium underline">
              View cart
            </Link>
          ) : null}
        </p>
      ) : null}
      <p className="text-xs text-slate-500 dark:text-slate-400">SKU {variant.sku}</p>
    </div>
  );
}
