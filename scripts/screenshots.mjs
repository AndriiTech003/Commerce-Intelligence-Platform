import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv[2] ?? 'smoke';
const stack = JSON.parse(readFileSync(join(root, '.smoke', `${profile}.json`), 'utf8'));
const { ports } = stack;
const api = `http://127.0.0.1:${ports.api}`;
const admin = `http://127.0.0.1:${ports.admin}`;
const shop = `http://runhub.localhost:${ports.storefront}`;
const grafana = process.env.GRAFANA_URL ?? 'http://127.0.0.1:4192';
const out = join(root, 'docs', 'assets');
mkdirSync(out, { recursive: true });

async function json(method, path, body, headers = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function login(page, email) {
  await page.goto(`${admin}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('current-user').waitFor();
}

const shots = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const owner = await json('POST', '/v1/auth/login', { email: 'owner@runhub.dev', password: 'demo1234' });
const tenantId = owner.memberships.find((m) => m.slug === 'runhub').tenantId;
const oh = { authorization: `Bearer ${owner.accessToken}`, 'x-tenant-id': tenantId };
const campaigns = await json('GET', '/v1/admin/campaigns', undefined, oh);
const demo = campaigns.data.find((c) => c.name === 'Spring running push') ?? campaigns.data[0];

await login(page, 'marketer@runhub.dev');
await page.goto(`${admin}/marketing/campaigns/${demo.id}`);
await page.getByTestId('experiment-view').waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
await page.getByTestId('experiment-view').screenshot({ path: join(out, 'experiment-view.png') });
shots.push('experiment-view.png');
const card = page.getByTestId('creative-card').first();
await card.screenshot({ path: join(out, 'creative-card.png') });
shots.push('creative-card.png');

await page.goto(`${admin}/marketing/review`);
await page.waitForTimeout(2000);
await page.screenshot({ path: join(out, 'review-queue.png'), fullPage: false });
shots.push('review-queue.png');

await page.goto(`${admin}/marketing/segments`);
await page.waitForTimeout(2000);
await page.screenshot({ path: join(out, 'segments.png') });
shots.push('segments.png');

const customers = await json('GET', '/v1/admin/customers?limit=50', undefined, oh);
const customer = customers.data.find((c) => c.registered && c.ordersCount > 0) ?? customers.data[0];
await login(page, 'owner@runhub.dev');
await page.goto(`${admin}/customers/${customer.id}`);
await page.waitForTimeout(3000);
await page.screenshot({ path: join(out, 'customer-profile.png'), fullPage: true });
shots.push('customer-profile.png');

await page.goto(`${admin}/live`);
await page.waitForTimeout(6000);
await page.screenshot({ path: join(out, 'live-dashboard.png') });
shots.push('live-dashboard.png');

await login(page, 'platform@cip.dev');
await page.goto(`${admin}/platform/simulator`);
await page.getByTestId('ground-truth-table').waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: join(out, 'ground-truth.png'), fullPage: true });
shots.push('ground-truth.png');

const shopper = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const storePage = await shopper.newPage();
await storePage.goto(`${shop}/?demo=1`);
const consent = storePage.getByTestId('consent-accept');
if (await consent.isVisible().catch(() => false)) await consent.click();
await storePage.getByTestId('why-this-button').first().waitFor({ timeout: 30000 });
await storePage.screenshot({ path: join(out, 'storefront-home.png') });
shots.push('storefront-home.png');
await storePage.getByTestId('why-this-button').first().click();
await storePage.getByTestId('why-this-panel').waitFor();
await storePage.waitForTimeout(1500);
await storePage.screenshot({ path: join(out, 'why-this.png') });
shots.push('why-this.png');
await shopper.close();

for (const uid of ['cip-event-pipeline', 'cip-personalization', 'cip-business', 'cip-system-overview']) {
  const ok = await fetch(`${grafana}/api/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!ok) break;
  await page.goto(`${grafana}/d/${uid}?orgId=1&from=now-45m&to=now&kiosk&var-profile=${profile}`);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(out, `grafana-${uid.replace('cip-', '')}.png`) });
  shots.push(`grafana-${uid.replace('cip-', '')}.png`);
}

await browser.close();
console.log(`screenshots: wrote ${shots.length} files to docs/assets: ${shots.join(', ')}`);
