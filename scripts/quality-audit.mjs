import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const profile = args.find((a) => !a.startsWith('--')) ?? 'smoke';
const flags = new Set(args.filter((a) => a.startsWith('--')));
const OUT = process.env.QUALITY_OUT ?? join(root, 'docs', 'assets', 'quality');
const CDP_PORT = Number(process.env.CDP_PORT ?? 4199);
const RUNS = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const FORM_FACTORS = (process.env.FORM_FACTORS ?? 'mobile,desktop').split(',');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const BUDGET = { lcpMs: 2500, cls: 0.1 };

function log(message) {
  process.stdout.write(`quality: ${message}\n`);
}

const stack = JSON.parse(readFileSync(join(root, '.smoke', `${profile}.json`), 'utf8'));
const api = `http://127.0.0.1:${stack.ports.api}`;
const admin = `http://127.0.0.1:${stack.ports.admin}`;
const shop = `http://runhub.localhost:${stack.ports.storefront}`;

async function json(path, headers = {}) {
  const res = await fetch(`${api}${path}`, { headers });
  return res.json();
}

async function fixtures() {
  const headers = { 'x-store': 'runhub' };
  const categories = await json('/v1/storefront/catalog/categories', headers);
  const category = categories.data.find((c) => !c.parentId && c.productCount > 0) ?? categories.data[0];
  const products = await json('/v1/storefront/catalog/products?limit=24', headers);
  const product = products.data.find((p) => p.available) ?? products.data[0];
  return { categorySlug: category.slug, productSlug: product.slug };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function dismissConsent(page) {
  const consent = page.getByTestId('consent-accept');
  if (await consent.isVisible().catch(() => false)) await consent.click();
}

async function prepareCart(page, productSlug) {
  await page.goto(`${shop}/p/${productSlug}`);
  await dismissConsent(page);
  await page.getByTestId('product-page').waitFor();
  const select = page.getByTestId('variant-select');
  const options = await select.locator('option').allTextContents();
  const available = options.findIndex((text) => !text.includes('sold out'));
  if (available >= 0) await select.selectOption({ index: available });
  await page.getByTestId('add-to-cart').click();
  await page.getByTestId('cart-count').filter({ hasText: /[1-9]/ }).waitFor();
}

async function adminLogin(page) {
  await page.goto(`${admin}/login`);
  await page.getByLabel('Email').fill('owner@runhub.dev');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('current-user').waitFor();
}

function summarize(lhr) {
  const audit = (id) => lhr.audits[id]?.numericValue ?? null;
  const score = (id) =>
    (lhr.categories[id]?.score ?? null) === null ? null : Math.round(lhr.categories[id].score * 100);
  return {
    performance: score('performance'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    seo: score('seo'),
    lcpMs: audit('largest-contentful-paint'),
    cls: audit('cumulative-layout-shift'),
    fcpMs: audit('first-contentful-paint'),
    tbtMs: audit('total-blocking-time'),
    speedIndexMs: audit('speed-index'),
    failedAccessibilityAudits: Object.values(lhr.categories.accessibility?.auditRefs ?? [])
      .map((ref) => lhr.audits[ref.id])
      .filter((a) => a && a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary')
      .map((a) => a.id),
  };
}

async function runLighthouse(page, formFactor, keepStorage) {
  const config = formFactor === 'desktop' ? desktopConfig : undefined;
  const runs = [];
  let report = null;
  for (let i = 0; i < RUNS; i += 1) {
    const result = await lighthouse(
      page.url,
      {
        port: CDP_PORT,
        output: 'html',
        logLevel: 'error',
        disableStorageReset: keepStorage,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        formFactor,
        screenEmulation:
          formFactor === 'desktop'
            ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
            : undefined,
      },
      config,
    );
    runs.push(summarize(result.lhr));
    if (i === Math.floor(RUNS / 2) || report === null) report = result.report;
  }
  const pickMedian = (key) => median(runs.map((r) => r[key]).filter((v) => v !== null));
  return {
    runs,
    median: {
      performance: pickMedian('performance'),
      accessibility: pickMedian('accessibility'),
      bestPractices: pickMedian('bestPractices'),
      seo: pickMedian('seo'),
      lcpMs: pickMedian('lcpMs'),
      cls: pickMedian('cls'),
      fcpMs: pickMedian('fcpMs'),
      tbtMs: pickMedian('tbtMs'),
      speedIndexMs: pickMedian('speedIndexMs'),
    },
    failedAccessibilityAudits: [...new Set(runs.flatMap((r) => r.failedAccessibilityAudits))],
    report,
  };
}

async function runAxe(context, page, colorScheme) {
  const tab = await context.newPage();
  try {
    await tab.emulateMedia({ colorScheme });
    await tab.goto(page.url, { waitUntil: 'load' });
    await dismissConsent(tab);
    if (page.ready) await tab.getByTestId(page.ready).first().waitFor({ timeout: 30000 });
    await tab.waitForTimeout(1500);
    const result = await new AxeBuilder({ page: tab }).withTags(AXE_TAGS).analyze();
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      tags: v.tags.filter((t) => t.startsWith('wcag') || t === 'best-practice'),
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  } finally {
    await tab.close();
  }
}

async function main() {
  const fx = await fixtures();
  const pages = [
    { app: 'storefront', name: 'home', url: `${shop}/`, ready: 'product-card', keepStorage: false },
    {
      app: 'storefront',
      name: 'category',
      url: `${shop}/c/${fx.categorySlug}`,
      ready: 'product-card',
      keepStorage: false,
    },
    {
      app: 'storefront',
      name: 'pdp',
      url: `${shop}/p/${fx.productSlug}`,
      ready: 'product-page',
      keepStorage: false,
    },
    { app: 'storefront', name: 'cart', url: `${shop}/cart`, ready: 'cart-item', keepStorage: true },
    { app: 'storefront', name: 'checkout', url: `${shop}/checkout`, ready: null, keepStorage: true },
    { app: 'admin', name: 'dashboard', url: `${admin}/`, ready: 'current-user', keepStorage: true },
    { app: 'admin', name: 'orders', url: `${admin}/orders`, ready: 'current-user', keepStorage: true },
    { app: 'admin', name: 'products', url: `${admin}/products`, ready: 'current-user', keepStorage: true },
  ];
  const only = process.env.PAGES ? process.env.PAGES.split(',') : null;
  const selected = only ? pages.filter((p) => only.includes(`${p.app}:${p.name}`)) : pages;
  const userDataDir = mkdtempSync(join(tmpdir(), 'cip-quality-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`],
    viewport: { width: 1350, height: 940 },
  });
  const results = [];
  const loadBefore = loadavg();
  try {
    const setup = await context.newPage();
    await adminLogin(setup);
    await setup.close();
    mkdirSync(OUT, { recursive: true });
    for (const page of selected) {
      if (page.app === 'storefront' && page.keepStorage) {
        const prep = await context.newPage();
        await prepareCart(prep, fx.productSlug);
        await prep.close();
      }
      const entry = {
        app: page.app,
        page: page.name,
        url: page.url.replace(/:\d+/, ':PORT'),
        lighthouse: {},
        axe: {},
      };
      if (!flags.has('--axe-only')) {
        for (const formFactor of FORM_FACTORS) {
          const lh = await runLighthouse(page, formFactor, page.keepStorage);
          writeFileSync(join(OUT, `lighthouse-${page.app}-${page.name}-${formFactor}.html`), lh.report);
          delete lh.report;
          entry.lighthouse[formFactor] = lh;
          log(
            `${page.app}/${page.name} ${formFactor}: perf ${lh.median.performance}, a11y ${lh.median.accessibility}, LCP ${Math.round(lh.median.lcpMs)} ms, CLS ${lh.median.cls.toFixed(3)}, TBT ${Math.round(lh.median.tbtMs)} ms${lh.failedAccessibilityAudits.length ? `, failed a11y audits: ${lh.failedAccessibilityAudits.join(', ')}` : ''}`,
          );
        }
      }
      if (!flags.has('--lighthouse-only')) {
        for (const scheme of page.app === 'admin' ? ['light', 'dark'] : ['light']) {
          entry.axe[scheme] = await runAxe(context, page, scheme);
          const v = entry.axe[scheme];
          log(
            `${page.app}/${page.name} axe (${scheme}): ${v.length} violations${v.length ? `: ${v.map((x) => `${x.id} (${x.impact}, ${x.nodes})`).join(', ')}` : ''}`,
          );
        }
      }
      results.push(entry);
    }
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
  const summary = {
    date: new Date().toISOString(),
    runsPerPage: RUNS,
    loadBefore,
    loadAfter: loadavg(),
    lighthouseVersion: JSON.parse(
      readFileSync(join(root, 'node_modules', 'lighthouse', 'package.json'), 'utf8'),
    ).version,
    axeTags: AXE_TAGS,
    budget: BUDGET,
    results,
  };
  if (!only) {
    writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(OUT, 'summary.md'), markdown(summary));
    log(`wrote ${join(OUT, 'summary.md')}`);
  }
  const storefrontOverBudget = results
    .filter((r) => r.app === 'storefront')
    .flatMap((r) =>
      Object.entries(r.lighthouse)
        .filter(([, lh]) => lh.median.lcpMs >= BUDGET.lcpMs || lh.median.cls >= BUDGET.cls)
        .map(([ff]) => `${r.page}/${ff}`),
    );
  const wcagViolations = results.flatMap((r) =>
    Object.values(r.axe).flatMap((list) => list.filter((v) => v.tags.some((t) => t.startsWith('wcag')))),
  );
  log(
    `storefront pages over the LCP/CLS budget: ${storefrontOverBudget.length ? storefrontOverBudget.join(', ') : 'none'}; WCAG violations: ${wcagViolations.length}`,
  );
  process.exit(flags.has('--strict') && (storefrontOverBudget.length || wcagViolations.length) ? 1 : 0);
}

function markdown(summary) {
  const lines = [
    '# Lighthouse and axe report',
    '',
    `Generated by \`node scripts/quality-audit.mjs\` on ${summary.date} against a local production build (\`next start\`, smoke stack), Lighthouse ${summary.lighthouseVersion}, headless Chromium from Playwright, ${summary.runsPerPage} Lighthouse runs per page and form factor (median shown; mobile = Lighthouse default simulated throttling, desktop = desktop preset). Load average before ${summary.loadBefore.map((v) => v.toFixed(2)).join(' / ')}, after ${summary.loadAfter.map((v) => v.toFixed(2)).join(' / ')}. Budget for the storefront: LCP < ${summary.budget.lcpMs} ms and CLS < ${summary.budget.cls}. axe tags: ${summary.axeTags.join(', ')}.`,
    '',
    '| App | Page | Form factor | Perf | A11y | Best practices | SEO | LCP | CLS | TBT | FCP | Budget |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of summary.results) {
    for (const [ff, lh] of Object.entries(r.lighthouse)) {
      const m = lh.median;
      const within =
        r.app === 'storefront'
          ? m.lcpMs < summary.budget.lcpMs && m.cls < summary.budget.cls
            ? 'ok'
            : 'over'
          : '—';
      lines.push(
        `| ${r.app} | ${r.page} | ${ff} | ${m.performance} | ${m.accessibility} | ${m.bestPractices} | ${m.seo} | ${(m.lcpMs / 1000).toFixed(2)} s | ${m.cls.toFixed(3)} | ${Math.round(m.tbtMs)} ms | ${(m.fcpMs / 1000).toFixed(2)} s | ${within} |`,
      );
    }
  }
  lines.push('', '## axe violations', '', '| App | Page | Color scheme | Violations |', '|---|---|---|---|');
  for (const r of summary.results) {
    for (const [scheme, list] of Object.entries(r.axe)) {
      lines.push(
        `| ${r.app} | ${r.page} | ${scheme} | ${list.length === 0 ? 'none' : list.map((v) => `${v.id} (${v.impact}, ${v.nodes} nodes)`).join('; ')} |`,
      );
    }
  }
  lines.push('', 'HTML reports: `lighthouse-<app>-<page>-<form factor>.html` in this folder.', '');
  return `${lines.join('\n')}\n`;
}

await main();
