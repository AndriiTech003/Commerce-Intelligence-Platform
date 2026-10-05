import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, adminLogin, api, COLLECTOR, staffLogin, storeUrl } from './helpers';

async function acceptConsent(page: Page) {
  const consent = page.getByTestId('consent-accept');
  if (await consent.isVisible().catch(() => false)) await consent.click();
}

async function openCategoryWithLearningDecision(browser: Browser, campaignId: string) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${storeUrl('runhub')}/c/running`);
    await acceptConsent(page);
    await page.reload();
    const block = page.locator(`[data-testid="personalized-campaign"][data-campaign-id="${campaignId}"]`);
    if (
      !(await block.waitFor({ state: 'visible', timeout: 15000 }).then(
        () => true,
        () => false,
      ))
    ) {
      await context.close();
      continue;
    }
    const decisionId = await block.getAttribute('data-decision-id');
    const explanation = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/storefront/decisions/${id}/explanation`, { credentials: 'include' });
      return res.ok ? ((await res.json()) as { creative: { policy: string } }) : null;
    }, decisionId);
    if (explanation && explanation.creative.policy !== 'holdout_uniform') return { context, page, block };
    await context.close();
  }
  throw new Error('no non-holdout decision for the new campaign');
}

test('marketer: campaign → generate with the Fake LLM → approve → block on the storefront → click → experiment counter grows', async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  await adminLogin(page, 'marketer@runhub.dev');
  await page.goto(`${ADMIN}/marketing/campaigns`);
  await page.getByTestId('new-campaign').click();
  await page.getByTestId('placement-category_banner').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('goal-click').click();
  const name = `E2E banner ${randomUUID().slice(0, 6)}`;
  await page.getByTestId('campaign-name').fill(name);
  await page.getByTestId('campaign-create').click();
  await expect(page).toHaveURL(/\/marketing\/campaigns\/[0-9a-f-]{36}/);
  const campaignId = page.url().split('/').pop()!;
  const segment = page.getByTestId('generate-segment-_default');
  if (!(await segment.isChecked())) await segment.check();
  for (const tone of ['performance', 'value']) {
    const box = page.getByTestId(`generate-tone-${tone}`);
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByTestId('generate-creatives').click();
  const drafts = page.locator('[data-testid="creative-card"][data-status="draft"]');
  await expect(drafts.first()).toBeVisible({ timeout: 30000 });
  const approvable = drafts.filter({ has: page.locator('[data-testid="approve-creative"]:enabled') }).first();
  const headline = (await approvable.getByTestId('creative-headline').textContent())!.trim();
  await approvable.getByTestId('approve-creative').click();
  await expect(
    page.locator('[data-testid="creative-card"][data-status="approved"]').filter({ hasText: headline }),
  ).toBeVisible();
  await page.getByTestId('activate-campaign').click();
  await expect(page.getByTestId('campaign-status')).toHaveText(/active/i);

  const { context, page: shop, block } = await openCategoryWithLearningDecision(browser, campaignId);
  await block.scrollIntoViewIfNeeded();
  await shop.waitForTimeout(1500);
  await block.getByTestId('campaign-cta').click();
  await shop.waitForTimeout(500);
  await context.close();

  await page.goto(`${ADMIN}/marketing/campaigns/${campaignId}`);
  await expect(page.getByTestId('experiment-view')).toBeVisible();
  await expect
    .poll(
      async () => {
        const cells = await page.getByTestId('arm-successes').allTextContents();
        return cells.reduce((sum, text) => sum + (Number(text.replace(/[^0-9]/g, '')) || 0), 0);
      },
      { timeout: 60000, intervals: [2000] },
    )
    .toBeGreaterThanOrEqual(1);
  const impressions = await page.getByTestId('arm-impressions').allTextContents();
  expect(
    impressions.reduce((sum, text) => sum + (Number(text.replace(/[^0-9]/g, '')) || 0), 0),
  ).toBeGreaterThanOrEqual(1);
});

test('customer profile shows affinities and segments; segment builder previews matching profiles', async ({
  page,
}) => {
  test.setTimeout(120000);
  const login = await api(
    'POST',
    '/v1/storefront/auth/login',
    { email: 'customer@runhub.dev', password: 'demo1234' },
    { 'x-store': 'runhub' },
  );
  expect(login.status).toBe(200);
  const customerId = login.body.customer.id as string;
  const store = await api('GET', '/v1/storefront/store', undefined, { 'x-store': 'runhub' });
  const products = await api(
    'GET',
    '/v1/storefront/catalog/products?category=road-shoes&limit=6',
    undefined,
    { 'x-store': 'runhub' },
  );
  const session = randomUUID();
  const events = products.body.data
    .slice(0, 5)
    .map((p: { id: string; categoryPath: string; priceMinCents: number }) => ({
      event_id: randomUUID(),
      event_type: 'product_viewed',
      occurred_at: new Date().toISOString(),
      anonymous_id: randomUUID(),
      customer_id: customerId,
      session_id: session,
      properties: { product_id: p.id, category_path: p.categoryPath, price_cents: p.priceMinCents },
    }));
  const sent = await fetch(`${COLLECTOR}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': store.body.trackingKey },
    body: JSON.stringify({ events }),
  });
  expect(sent.status).toBe(202);
  const owner = await staffLogin('owner@runhub.dev');
  const headers = {
    authorization: `Bearer ${owner.accessToken}`,
    'x-tenant-id': owner.memberships.find((m) => m.slug === 'runhub')!.tenantId,
  };
  await expect
    .poll(
      async () =>
        (await api('GET', `/v1/admin/customers/${customerId}/profile`, undefined, headers)).body.source,
      { timeout: 20000 },
    )
    .toBe('live');
  await adminLogin(page, 'owner@runhub.dev');
  await page.goto(`${ADMIN}/customers/${customerId}`);
  await expect(page.getByTestId('profile-affinity')).toContainText('running');
  await expect(page.getByTestId('profile-intent')).toBeVisible();
  await expect(page.getByTestId('profile-segments').getByTestId('profile-segment').first()).toBeVisible();
  await expect(page.getByTestId('profile-segments')).toContainText('≥');

  await expect
    .poll(
      async () => {
        const res = await api(
          'POST',
          '/v1/admin/segments/preview',
          { rules: { all: [{ feature: 'aff.cat.running', op: 'gte', value: 1 }] } },
          headers,
        );
        return res.body.count;
      },
      { timeout: 40000, intervals: [2000] },
    )
    .toBeGreaterThanOrEqual(1);
  await page.goto(`${ADMIN}/marketing/segments`);
  await page.getByTestId('new-segment').click();
  await page.getByTestId('segment-key').fill(`e2e_${randomUUID().slice(0, 6)}`);
  await page.getByTestId('segment-name').fill('E2E runners');
  const condition = page.getByTestId('rule-condition').first();
  await condition.getByTestId('rule-feature').fill('aff.cat.running');
  await condition.getByTestId('rule-operator').selectOption('gte');
  await condition.getByTestId('rule-value').fill('1');
  await expect
    .poll(async () => Number(await page.getByTestId('segment-preview-count').getAttribute('data-count')), {
      timeout: 20000,
    })
    .toBeGreaterThanOrEqual(1);
  await page.getByTestId('save-segment').click();
  await expect(page).toHaveURL(/\/marketing\/segments/);
});

test('platform simulator screen: start, ground truth vs learned table, shift and stop', async ({ page }) => {
  test.setTimeout(120000);
  await adminLogin(page, 'platform@cip.dev');
  await page.goto(`${ADMIN}/platform/simulator`);
  await page.getByTestId('simulator-rate').fill('3');
  await page.getByTestId('simulator-start').click();
  await expect(page.getByTestId('simulator-status')).toHaveText(/running/i);
  await expect(page.getByTestId('ground-truth-table').getByTestId('ground-truth-row').first()).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByTestId('ground-truth-table')).toContainText('marathon_runner');
  await expect(page.getByTestId('simulator-shift')).toBeVisible();
  await page.getByTestId('simulator-stop').click();
  await expect(page.getByTestId('simulator-status')).toHaveText(/stopped/i);
});
