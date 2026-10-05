import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN, adminLogin, api, COLLECTOR, placeOrderViaApi, staffLogin, storeUrl } from './helpers';

test('guest checkout: catalog → product → cart → promo code → checkout → paid', async ({ page }) => {
  await page.goto(storeUrl('runhub'));
  const consent = page.getByTestId('consent-accept');
  if (await consent.isVisible().catch(() => false)) await consent.click();
  const home = page.url();
  let added = false;
  for (let index = 0; index < 6 && !added; index++) {
    await page.goto(home);
    await page.getByTestId('product-card').nth(index).click();
    await expect(page.getByTestId('product-page')).toBeVisible();
    const select = page.getByTestId('variant-select');
    const options = await select.locator('option').allTextContents();
    const available = options.findIndex((text) => !text.includes('sold out'));
    if (available < 0) continue;
    await select.selectOption({ index: available });
    await page.getByTestId('add-to-cart').click();
    added = true;
  }
  expect(added).toBe(true);
  await expect(page.getByTestId('cart-count')).toHaveText('1');
  await page.getByTestId('cart-link').click();
  await expect(page.getByTestId('cart-item')).toHaveCount(1);
  await page.getByTestId('promo-input').fill('WELCOME10');
  await page.getByTestId('promo-apply').click();
  await expect(page.getByTestId('cart-discount')).toBeVisible();
  await page.getByTestId('checkout-button').click();
  await page.locator('input[name="email"]').fill(`guest-${randomUUID().slice(0, 6)}@buyer.dev`);
  await page.locator('input[name="name"]').fill('Guest Buyer');
  await page.locator('input[name="line1"]').fill('Main street 1');
  await page.locator('input[name="city"]').fill('Berlin');
  await page.locator('input[name="postalCode"]').fill('10115');
  await page.locator('[name="country"]').selectOption('DE');
  await page.getByTestId('checkout-next').click();
  await page.getByTestId('shipping-standard').check();
  await page.getByTestId('checkout-next').click();
  await page.getByTestId('card-number').fill('4242 4242 4242 4242');
  await page.getByTestId('place-order').click();
  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByTestId('order-status')).toHaveText('paid', { timeout: 30000 });
  await expect(page.getByTestId('order-number')).toContainText(/\d+/);
});

test('merchant creates a product with an image and it appears on the storefront', async ({ page }) => {
  await adminLogin(page, 'catalog@runhub.dev');
  await page.goto(`${ADMIN}/products/new`);
  const title = `E2E Trail Shoe ${randomUUID().slice(0, 6)}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Brand', { exact: true }).fill('E2E Brand');
  const row = page.getByTestId('variant-row').first();
  await row.getByLabel('SKU').fill(`E2E-${randomUUID().slice(0, 8)}`);
  await row.getByLabel('Variant title').fill('42');
  await row.getByLabel('Price', { exact: true }).fill('129.00');
  await row.getByLabel('Stock', { exact: true }).fill('7');
  await page.getByTestId('save-product').click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ea580c"/></svg>',
  );
  await page
    .getByTestId('image-input')
    .setInputFiles({ name: 'shoe.svg', mimeType: 'image/svg+xml', buffer: svg });
  await expect(page.getByTestId('product-images').locator('img')).toHaveCount(1);
  const slug = (await page
    .locator('p')
    .filter({ hasText: /^\/.+ · version/ })
    .first()
    .textContent())!
    .split(' · ')[0]!
    .slice(1);
  await page.goto(`${storeUrl('runhub')}/p/${slug}`);
  await expect(page.getByTestId('product-title')).toHaveText(title);
  await expect(page.getByTestId('gallery').locator('img')).toHaveCount(1);
  await page.goto(`${storeUrl('runhub')}/search?q=${encodeURIComponent(title)}`);
  await expect(
    page.getByTestId('product-card').filter({ hasText: title, visible: true }).first(),
  ).toBeVisible();
});

test('live dashboard shows tracking events within 5 seconds', async ({ page }) => {
  await adminLogin(page, 'owner@runhub.dev');
  await page.goto(`${ADMIN}/live`);
  await expect(page.getByTestId('live-status')).toHaveText('live');
  const store = await api('GET', '/v1/storefront/store', undefined, { 'x-store': 'runhub' });
  const events = Array.from({ length: 10 }, () => ({
    event_id: randomUUID(),
    event_type: 'product_viewed',
    occurred_at: new Date().toISOString(),
    anonymous_id: randomUUID(),
    properties: {
      product_id: randomUUID(),
      category_path: 'running',
      price_cents: 9900,
      title: 'Live Event Shoe',
    },
  }));
  const started = Date.now();
  const response = await fetch(`${COLLECTOR}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': store.body.trackingKey },
    body: JSON.stringify({ events }),
  });
  expect(response.status).toBe(202);
  await expect(page.getByTestId('feed-item').filter({ hasText: 'Live Event Shoe' }).first()).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId('kpi-active')).not.toHaveAttribute('data-value', '0', { timeout: 5000 });
  expect(Date.now() - started).toBeLessThan(5000);
});

test('RunHub staff cannot see HomeBrew orders, not even by URL', async ({ page }) => {
  const order = await placeOrderViaApi('homebrew');
  const homebrewOwner = await staffLogin('owner@homebrew.dev');
  const visible = await api('GET', `/v1/admin/orders/${order.orderId}`, undefined, {
    authorization: `Bearer ${homebrewOwner.accessToken}`,
    'x-tenant-id': homebrewOwner.memberships[0]!.tenantId,
  });
  expect(visible.status).toBe(200);
  await adminLogin(page, 'support@runhub.dev');
  await expect(page.getByTestId('tenant-switcher').locator('option')).toHaveCount(1);
  await page.goto(`${ADMIN}/orders/${order.orderId}`);
  await expect(page.getByRole('alert').filter({ hasText: /not found/i })).toBeVisible();
  await expect(page.getByTestId('order-detail-status')).toHaveCount(0);
  await page.goto(`${ADMIN}/orders?email=${encodeURIComponent('e2e-')}`);
  await expect(page.getByTestId('order-row').filter({ hasText: `#${order.number}` })).toHaveCount(0);
});
