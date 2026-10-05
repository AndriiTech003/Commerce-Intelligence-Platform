import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { PORTS } from './playwright.config';

export const API = `http://127.0.0.1:${PORTS.api}`;
export const ADMIN = `http://127.0.0.1:${PORTS.admin}`;
export const COLLECTOR = `http://127.0.0.1:${PORTS.collector}`;
export const storeUrl = (store: string) => `http://${store}.localhost:${PORTS.storefront}`;

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

export async function staffLogin(email: string) {
  const res = await api('POST', '/v1/auth/login', { email, password: 'demo1234' });
  expect(res.status).toBe(200);
  return res.body as { accessToken: string; memberships: Array<{ tenantId: string; slug: string }> };
}

export async function adminLogin(page: Page, email: string) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('current-user')).toHaveText(email);
}

export async function placeOrderViaApi(store: string) {
  const headers = { 'x-store': store, 'x-anonymous-id': randomUUID() };
  const list = await api('GET', '/v1/storefront/catalog/products?limit=5', undefined, headers);
  const slug = list.body.data.find((p: { available: boolean }) => p.available).slug;
  const product = await api('GET', `/v1/storefront/catalog/products/${slug}`, undefined, headers);
  const variant = product.body.variants.find((v: { available: number }) => v.available > 0);
  await api('POST', '/v1/storefront/cart/items', { variantId: variant.id, quantity: 1 }, headers);
  const order = await api(
    'POST',
    '/v1/storefront/checkout',
    {
      email: `e2e-${randomUUID().slice(0, 8)}@buyer.dev`,
      shippingAddress: { name: 'E2E', line1: 'Main 1', city: 'Berlin', postalCode: '10115', country: 'DE' },
      shippingMethod: 'standard',
    },
    { ...headers, 'idempotency-key': `e2e-${randomUUID()}` },
  );
  expect(order.status).toBe(201);
  return order.body as { orderId: string; number: number };
}
