import type { Persona } from './personas';

export type Random = () => number;

export interface CatalogProduct {
  id: string;
  title: string;
  slug: string;
  priceMinCents: number | null;
  categoryPath: string | null;
  brand: string | null;
}

export function pickWeighted<T>(items: Array<{ item: T; weight: number }>, rand: Random): T | null {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (total <= 0) return items.length > 0 ? items[Math.floor(rand() * items.length)]!.item : null;
  let r = rand() * total;
  for (const entry of items) {
    r -= Math.max(0, entry.weight);
    if (r <= 0) return entry.item;
  }
  return items[items.length - 1]!.item;
}

export function pickPersona(personas: Persona[], rand: Random, shares: Record<string, number> = {}): Persona {
  return pickWeighted(
    personas.map((p) => ({ item: p, weight: shares[p.key] ?? p.share })),
    rand,
  )!;
}

export function categoryMatch(path: string | null, prefix: string): boolean {
  if (!path) return false;
  return path === prefix || path.startsWith(`${prefix}.`);
}

export function inPersonaCategories(product: CatalogProduct, persona: Persona): boolean {
  return Object.keys(persona.categories).some((c) => categoryMatch(product.categoryPath, c));
}

export function priceAffinity(priceCents: number | null, persona: Persona): number {
  if (priceCents === null) return 0.2;
  const z = (priceCents / 100 - persona.price.mean) / persona.price.sd;
  return Math.exp(-0.5 * z * z) + 0.02;
}

export function pickProduct(
  products: CatalogProduct[],
  persona: Persona,
  rand: Random,
): CatalogProduct | null {
  const category = pickWeighted(
    Object.entries(persona.categories).map(([item, weight]) => ({ item, weight })),
    rand,
  );
  const pool = category ? products.filter((p) => categoryMatch(p.categoryPath, category)) : [];
  const candidates = pool.length > 0 ? pool : products;
  return pickWeighted(
    candidates.map((p) => ({ item: p, weight: priceAffinity(p.priceMinCents, persona) })),
    rand,
  );
}

export function poissonish(mean: number, rand: Random): number {
  const l = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > l && k < mean * 4 + 10);
  return Math.max(1, k - 1);
}

export function effectiveMultipliers(
  persona: Persona,
  shifted: Record<string, Record<string, number>>,
): Record<string, number> {
  return { ...persona.tone_multipliers, ...(shifted[persona.key] ?? {}) };
}

export function relevance(products: Array<{ categoryPath: string | null }>, persona: Persona): number {
  if (products.length === 0) return 1;
  const share =
    products.filter((p) => Object.keys(persona.categories).some((c) => categoryMatch(p.categoryPath, c)))
      .length / products.length;
  return 0.75 + 0.5 * share;
}

export function clickProbability(
  persona: Persona,
  tone: string | null,
  products: Array<{ categoryPath: string | null }>,
  shifted: Record<string, Record<string, number>> = {},
): number {
  const multipliers = effectiveMultipliers(persona, shifted);
  const multiplier = tone ? (multipliers[tone] ?? 1) : 1;
  return Math.min(1, persona.base_ctr * multiplier * relevance(products, persona));
}

export interface ArmTruth {
  creativeId: string;
  tone: string | null;
}

export function armProbabilities(
  arms: ArmTruth[],
  persona: Persona,
  products: Array<{ categoryPath: string | null }>,
  shifted: Record<string, Record<string, number>> = {},
): Record<string, number> {
  return Object.fromEntries(
    arms.map((a) => [a.creativeId, clickProbability(persona, a.tone, products, shifted)]),
  );
}

export function regretStep(
  probabilities: Record<string, number>,
  chosen: string,
): { thompson: number; uniform: number } {
  const values = Object.values(probabilities);
  if (values.length === 0) return { thompson: 0, uniform: 0 };
  const best = Math.max(...values);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { thompson: best - (probabilities[chosen] ?? mean), uniform: best - mean };
}

export interface SessionPlan {
  landing: 'home' | 'category' | 'product';
  views: number;
  revisitHome: boolean;
  addToCart: boolean;
  checkout: boolean;
  purchase: boolean;
  useDiscount: boolean;
  register: boolean;
}

export function planSession(persona: Persona, rand: Random): SessionPlan {
  const landingRoll = rand();
  const addToCart = rand() < persona.session.add_to_cart_p;
  const checkout = addToCart && rand() < persona.session.checkout_p;
  const purchase = checkout && rand() < persona.session.purchase_p;
  return {
    landing: landingRoll < 0.6 ? 'home' : landingRoll < 0.9 ? 'category' : 'product',
    views: poissonish(persona.session.pages_mean, rand),
    revisitHome: rand() < 0.6,
    addToCart,
    checkout,
    purchase,
    useDiscount: checkout && rand() < persona.discount_p,
    register: purchase && rand() < persona.register_p,
  };
}
