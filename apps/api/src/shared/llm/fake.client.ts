import { createHash } from 'node:crypto';
import { approximateTokens, type LlmClient, type LlmRequest, type LlmResponse } from './llm';

interface CreativeContext {
  storeName?: string;
  products?: Array<{ title: string; priceCents: number | null; brand?: string | null }>;
  tones?: string[];
  count?: number;
  currency?: string;
  discounts?: Array<{ code: string; type: string; value: number }>;
  untrusted?: string;
  segmentKey?: string;
}

interface InsightsContext {
  aggregates?: Record<string, unknown>;
}

function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length]!;
}

function money(cents: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${symbol}${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).trimEnd()}…`;
}

const TEMPLATES: Record<
  string,
  { headlines: string[]; bodies: string[]; ctas: string[]; rationale: string }
> = {
  performance: {
    headlines: [
      'Built for your next PR',
      'Faster miles start here',
      'Engineered for every split',
      'Train harder, recover faster',
    ],
    bodies: [
      '{product} is engineered for speed and comfort on every run.',
      'Lightweight, responsive and race-ready: meet {product}.',
      'Chase your next personal best with {product}.',
    ],
    ctas: ['Shop performance', 'Gear up now', 'Find your pace'],
    rationale: 'Performance framing matches segments with strong category affinity and high intent.',
  },
  lifestyle: {
    headlines: ['Gear that fits your weekend', 'Made for the way you move', 'Everyday adventures, sorted'],
    bodies: [
      'From trail to café: {product} keeps up with the way you live.',
      'Comfortable, versatile and easy to love: {product}.',
      'Your favourite weekends deserve {product}.',
    ],
    ctas: ['Explore the look', 'See the collection', 'Discover more'],
    rationale: 'Lifestyle framing highlights versatility for broad, browsing-oriented segments.',
  },
  value: {
    headlines: ['Smart picks, real value', 'Quality that fits your budget', 'Great gear, fair prices'],
    bodies: [
      'Get {product} from {price}: quality gear without overspending.',
      '{product} from {price}. Everything you need, nothing you do not.',
      'Prices from {price} on {product} and more.',
    ],
    ctas: ['See the deals', 'Shop smart', 'Browse value picks'],
    rationale: 'Value framing uses real catalogue prices for price-sensitive shoppers.',
  },
  premium: {
    headlines: [
      'Crafted for the discerning',
      'Premium, without compromise',
      'The details make the difference',
    ],
    bodies: [
      '{product}: premium materials and meticulous detail.',
      'Elevate every outing with {product}, made to last.',
      'Thoughtfully designed, beautifully finished: {product}.',
    ],
    ctas: ['Discover premium', 'Explore the range', 'View details'],
    rationale: 'Premium framing emphasises craftsmanship for high-price-band segments.',
  },
};

export class FakeLlmClient implements LlmClient {
  readonly provider = 'fake';
  readonly model = 'fake-template-v1';
  calls = 0;

  constructor(private readonly options: { invalidFirst?: number; latencyMs?: number } = {}) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls += 1;
    const started = Date.now();
    if (this.options.latencyMs) await new Promise((r) => setTimeout(r, this.options.latencyMs));
    const seed = parseInt(createHash('sha256').update(request.prompt).digest('hex').slice(0, 8), 16);
    let text: string;
    if ((this.options.invalidFirst ?? 0) >= this.calls) text = '{"variants": "not-a-list"}';
    else if (request.task === 'insights')
      text = JSON.stringify(this.insights((request.context ?? {}) as InsightsContext));
    else text = JSON.stringify(this.creatives((request.context ?? {}) as CreativeContext, seed));
    return {
      text,
      model: this.model,
      provider: this.provider,
      inputTokens: approximateTokens(request.system + request.prompt),
      outputTokens: approximateTokens(text),
      latencyMs: Date.now() - started,
      costUsd: 0,
    };
  }

  private creatives(ctx: CreativeContext, seed: number) {
    const products = ctx.products?.length
      ? ctx.products
      : [{ title: ctx.storeName ?? 'our collection', priceCents: null }];
    const tones = ctx.tones?.length ? ctx.tones : ['performance'];
    const currency = ctx.currency ?? 'USD';
    const prices = products
      .map((p) => p.priceCents)
      .filter((p): p is number => typeof p === 'number' && p > 0);
    const minPrice = prices.length ? Math.min(...prices) : null;
    const percent = ctx.discounts?.find((d) => d.type === 'percent');
    const injected =
      /ignore (all )?(previous|prior) instructions[^a-z0-9]*(?:and )?(?:write|say|add)?:?\s*([^\n]{3,120})/i.exec(
        ctx.untrusted ?? '',
      )?.[3];
    const variants = [];
    for (let i = 0; i < (ctx.count ?? 3); i++) {
      const tone = tones[i % tones.length]!;
      const t = TEMPLATES[tone] ?? TEMPLATES.performance!;
      const s = seed + i * 7919;
      const product = pick(products, s >>> 3);
      const name = clip(product.title, 40);
      let body = pick(t.bodies, s >>> 5)
        .replace('{product}', name)
        .replace('{price}', minPrice !== null ? money(minPrice, currency) : 'great prices');
      if (tone === 'value' && percent && i % 2 === 1)
        body = `Use code ${percent.code} for ${percent.value}% off ${name}.`;
      let rationale = t.rationale;
      if (tone !== 'value' && (s >>> 9) % 7 === 0) {
        body = `${clip(body, 120)} Now 25% off.`;
        rationale += ' Mentions a promotion to add urgency.';
      }
      if (injected && i === 0) body = injected.trim();
      variants.push({
        headline: clip(pick(t.headlines, s >>> 7), 60),
        body: clip(body, 160),
        cta: clip(pick(t.ctas, s >>> 11), 24),
        tone,
        rationale,
      });
    }
    return { variants };
  }

  private insights(ctx: InsightsContext) {
    const a = ctx.aggregates ?? {};
    const num = (key: string) => (typeof a[key] === 'number' ? (a[key] as number) : 0);
    const observations = [];
    const revenue = num('revenueCents');
    const previous = num('previousRevenueCents');
    const change = previous > 0 ? ((revenue - previous) / previous) * 100 : null;
    observations.push({
      title:
        change === null
          ? 'Revenue baseline established'
          : change >= 0
            ? 'Revenue is growing'
            : 'Revenue is down',
      detail:
        change === null
          ? `Revenue in the period was ${(revenue / 100).toFixed(2)} with no previous period to compare.`
          : `Revenue changed by ${change.toFixed(1)}% (${(previous / 100).toFixed(2)} → ${(revenue / 100).toFixed(2)}).`,
      severity:
        change !== null && change < -10 ? 'warning' : change !== null && change > 5 ? 'positive' : 'info',
      basis: [
        { metric: 'revenueCents', value: revenue },
        { metric: 'previousRevenueCents', value: previous },
      ],
    });
    const conversion = num('conversionRate');
    observations.push({
      title: 'Visitor to order conversion',
      detail: `${(conversion * 100).toFixed(2)}% of ${num('visitors')} visitors placed an order (${num('orders')} orders).`,
      severity: conversion < 0.01 ? 'warning' : 'info',
      basis: [
        { metric: 'conversionRate', value: conversion },
        { metric: 'visitors', value: num('visitors') },
        { metric: 'orders', value: num('orders') },
      ],
    });
    const drop = a.biggestFunnelDrop as { from?: string; to?: string; rate?: number } | undefined;
    if (drop?.from && drop.to && typeof drop.rate === 'number')
      observations.push({
        title: `Largest funnel drop: ${drop.from} → ${drop.to}`,
        detail: `Only ${(drop.rate * 100).toFixed(1)}% of users continue from ${drop.from} to ${drop.to}.`,
        severity: 'warning',
        basis: [{ metric: `funnel.${drop.from}->${drop.to}`, value: drop.rate }],
      });
    const top = a.topProduct as { title?: string; revenueCents?: number } | undefined;
    if (top?.title)
      observations.push({
        title: 'Best-selling product',
        detail: `${top.title} generated ${((top.revenueCents ?? 0) / 100).toFixed(2)} in revenue.`,
        severity: 'positive',
        basis: [{ metric: 'topProduct.revenueCents', value: top.revenueCents ?? 0 }],
      });
    const campaign = a.bestCreative as { headline?: string; ctr?: number; impressions?: number } | undefined;
    if (campaign?.headline)
      observations.push({
        title: 'Top creative',
        detail: `“${campaign.headline}” has a CTR of ${((campaign.ctr ?? 0) * 100).toFixed(2)}% over ${campaign.impressions ?? 0} impressions.`,
        severity: 'positive',
        basis: [
          { metric: 'bestCreative.ctr', value: campaign.ctr ?? 0 },
          { metric: 'bestCreative.impressions', value: campaign.impressions ?? 0 },
        ],
      });
    return { observations };
  }
}
