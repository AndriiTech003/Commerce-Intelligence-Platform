'use client';

import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@cip/api-client';
import { api } from './browser-api';
import type { Cart } from './types';

export const CART_KEY = ['cart'] as const;

export async function fetchCart(): Promise<Cart> {
  return unwrap(await api().GET('/v1/storefront/cart'));
}

export function useCart() {
  return useQuery({ queryKey: CART_KEY, queryFn: fetchCart });
}
