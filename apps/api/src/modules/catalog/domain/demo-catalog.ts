export interface DemoCategory {
  slug: string;
  name: string;
  parent: string | null;
}

export interface DemoVariant {
  sku: string;
  title: string;
  priceCents: number;
  compareAtCents: number | null;
  attributes: Record<string, string>;
  onHand: number;
}

export interface DemoProduct {
  title: string;
  slug: string;
  description: string;
  brand: string;
  categorySlug: string;
  attributes: Record<string, unknown>;
  tags: string[];
  status: 'active' | 'draft';
  variants: DemoVariant[];
}

export interface DemoCatalog {
  categories: DemoCategory[];
  products: DemoProduct[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Theme {
  categories: DemoCategory[];
  lines: Array<{
    category: string;
    nouns: string[];
    adjectives: string[];
    brands: string[];
    price: [number, number];
    variantAxis: { name: string; values: string[] };
    colors?: string[];
    attributes: Record<string, string[]>;
    tags: string[];
  }>;
}

const RUNHUB: Theme = {
  categories: [
    { slug: 'running', name: 'Running', parent: null },
    { slug: 'running-shoes', name: 'Running shoes', parent: 'running' },
    { slug: 'road-shoes', name: 'Road shoes', parent: 'running-shoes' },
    { slug: 'trail-shoes', name: 'Trail shoes', parent: 'running-shoes' },
    { slug: 'running-apparel', name: 'Running apparel', parent: 'running' },
    { slug: 'hiking', name: 'Hiking', parent: null },
    { slug: 'hiking-boots', name: 'Hiking boots', parent: 'hiking' },
    { slug: 'backpacks', name: 'Backpacks', parent: 'hiking' },
    { slug: 'accessories', name: 'Accessories', parent: null },
    { slug: 'watches', name: 'GPS watches', parent: 'accessories' },
    { slug: 'nutrition', name: 'Nutrition', parent: 'accessories' },
  ],
  lines: [
    {
      category: 'road-shoes',
      nouns: ['Runner', 'Glide', 'Tempo', 'Pace', 'Stride', 'Flyer'],
      adjectives: ['Ultra', 'Swift', 'Cloud', 'Neo', 'Pro', 'Aero', 'Rapid'],
      brands: ['Stridewell', 'Velocity', 'Northpace', 'Arclight'],
      price: [8900, 18900],
      variantAxis: { name: 'size', values: ['40', '41', '42', '43', '44', '45'] },
      colors: ['Black', 'White', 'Blue'],
      attributes: { activity: ['running'], terrain: ['road'], cushioning: ['neutral', 'max', 'responsive'] },
      tags: ['running', 'road', 'shoes'],
    },
    {
      category: 'trail-shoes',
      nouns: ['Trail Runner', 'Ridge', 'Summit', 'Rock', 'Canyon'],
      adjectives: ['X', 'GTX', 'Grip', 'Alpine', 'Wild'],
      brands: ['Stridewell', 'Mountain Co', 'Northpace'],
      price: [10900, 21900],
      variantAxis: { name: 'size', values: ['40', '41', '42', '43', '44', '45'] },
      colors: ['Olive', 'Black', 'Orange'],
      attributes: { activity: ['running'], terrain: ['trail'], waterproof: ['yes', 'no'] },
      tags: ['running', 'trail', 'shoes'],
    },
    {
      category: 'running-apparel',
      nouns: ['Tee', 'Shorts', 'Tights', 'Jacket', 'Singlet', 'Vest'],
      adjectives: ['Breeze', 'Dry', 'Thermal', 'Light', 'Reflective'],
      brands: ['Velocity', 'Arclight', 'Pulse'],
      price: [2500, 12900],
      variantAxis: { name: 'size', values: ['XS', 'S', 'M', 'L', 'XL'] },
      colors: ['Black', 'Navy', 'Red'],
      attributes: { activity: ['running'], season: ['summer', 'winter', 'all'] },
      tags: ['running', 'apparel'],
    },
    {
      category: 'hiking-boots',
      nouns: ['Boot', 'Trekker', 'Explorer', 'Ranger'],
      adjectives: ['Mid', 'High', 'Leather', 'Waterproof', 'Light'],
      brands: ['Mountain Co', 'Trailborn'],
      price: [12900, 26900],
      variantAxis: { name: 'size', values: ['40', '41', '42', '43', '44', '45', '46'] },
      colors: ['Brown', 'Grey'],
      attributes: { activity: ['hiking'], terrain: ['mountain', 'forest'] },
      tags: ['hiking', 'boots'],
    },
    {
      category: 'backpacks',
      nouns: ['Pack', 'Daypack', 'Hydration Pack', 'Rucksack'],
      adjectives: ['20L', '30L', '45L', '8L', '12L'],
      brands: ['Trailborn', 'Mountain Co', 'Pulse'],
      price: [3900, 18900],
      variantAxis: { name: 'color', values: ['Black', 'Green', 'Blue'] },
      attributes: { activity: ['hiking', 'running'] },
      tags: ['hiking', 'bags'],
    },
    {
      category: 'watches',
      nouns: ['Watch', 'Tracker', 'Band'],
      adjectives: ['GPS', 'Solar', 'Multisport', 'Trail', 'Lite'],
      brands: ['Pulse', 'Arclight'],
      price: [9900, 59900],
      variantAxis: { name: 'color', values: ['Black', 'Silver'] },
      attributes: { activity: ['running', 'hiking'] },
      tags: ['electronics', 'watches'],
    },
    {
      category: 'nutrition',
      nouns: ['Energy Gel', 'Bar', 'Electrolyte Mix', 'Recovery Shake'],
      adjectives: ['Citrus', 'Berry', 'Caffeinated', 'Salted', 'Vanilla'],
      brands: ['Fuelup', 'Pulse'],
      price: [300, 3900],
      variantAxis: { name: 'pack', values: ['Single', '6-pack', '24-pack'] },
      attributes: { activity: ['running'] },
      tags: ['nutrition'],
    },
  ],
};

const HOMEBREW: Theme = {
  categories: [
    { slug: 'coffee', name: 'Coffee', parent: null },
    { slug: 'single-origin', name: 'Single origin', parent: 'coffee' },
    { slug: 'blends', name: 'Blends', parent: 'coffee' },
    { slug: 'equipment', name: 'Equipment', parent: null },
    { slug: 'grinders', name: 'Grinders', parent: 'equipment' },
    { slug: 'brewers', name: 'Brewers', parent: 'equipment' },
    { slug: 'espresso-machines', name: 'Espresso machines', parent: 'equipment' },
    { slug: 'cups', name: 'Cups & mugs', parent: null },
  ],
  lines: [
    {
      category: 'single-origin',
      nouns: ['Ethiopia', 'Kenya', 'Colombia', 'Guatemala', 'Brazil', 'Rwanda', 'Peru', 'Panama'],
      adjectives: ['Yirgacheffe', 'Natural', 'Washed', 'Honey', 'Gesha', 'Reserve'],
      brands: ['Roastery 47', 'Bean Theory', 'Northern Roast'],
      price: [1400, 4900],
      variantAxis: { name: 'weight', values: ['250g', '500g', '1kg'] },
      attributes: { roast: ['light', 'medium'], process: ['washed', 'natural', 'honey'] },
      tags: ['coffee', 'beans'],
    },
    {
      category: 'blends',
      nouns: ['Espresso Blend', 'House Blend', 'Breakfast', 'Night Shift'],
      adjectives: ['Classic', 'Dark', 'Smooth', 'Bold'],
      brands: ['Roastery 47', 'Bean Theory'],
      price: [1200, 3600],
      variantAxis: { name: 'weight', values: ['250g', '1kg'] },
      attributes: { roast: ['medium', 'dark'] },
      tags: ['coffee', 'beans', 'espresso'],
    },
    {
      category: 'grinders',
      nouns: ['Grinder', 'Burr Mill', 'Hand Grinder'],
      adjectives: ['Conical', 'Flat', 'Precision', 'Travel'],
      brands: ['Grindworks', 'Kettle & Co'],
      price: [5900, 59900],
      variantAxis: { name: 'color', values: ['Black', 'Steel'] },
      attributes: { type: ['manual', 'electric'] },
      tags: ['equipment', 'grinder'],
    },
    {
      category: 'brewers',
      nouns: ['Dripper', 'French Press', 'AeroBrewer', 'Kettle', 'Cold Brew Jar'],
      adjectives: ['Glass', 'Ceramic', 'Steel', 'Gooseneck'],
      brands: ['Kettle & Co', 'Pour Lab'],
      price: [1900, 14900],
      variantAxis: { name: 'size', values: ['Small', 'Large'] },
      attributes: { method: ['pour-over', 'immersion'] },
      tags: ['equipment', 'brewing'],
    },
    {
      category: 'espresso-machines',
      nouns: ['Espresso Machine', 'Lever', 'Dual Boiler'],
      adjectives: ['Compact', 'Pro', 'Home', 'PID'],
      brands: ['Crema Works', 'Pour Lab'],
      price: [29900, 189900],
      variantAxis: { name: 'color', values: ['Steel', 'Black', 'White'] },
      attributes: { type: ['semi-automatic', 'lever'] },
      tags: ['equipment', 'espresso'],
    },
    {
      category: 'cups',
      nouns: ['Mug', 'Cup', 'Tumbler', 'Glass'],
      adjectives: ['Double-wall', 'Ceramic', 'Travel', 'Espresso'],
      brands: ['Pour Lab', 'Kettle & Co'],
      price: [900, 4500],
      variantAxis: { name: 'color', values: ['White', 'Black', 'Sand'] },
      attributes: { material: ['ceramic', 'glass', 'steel'] },
      tags: ['cups'],
    },
  ],
};

const THEMES: Record<string, Theme> = { runhub: RUNHUB, homebrew: HOMEBREW, default: RUNHUB };

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}

function roundPrice(cents: number): number {
  return Math.max(99, Math.round(cents / 100) * 100 - 1);
}

export function generateDemoCatalog(
  theme: string,
  count: number,
  seed: number,
  skuPrefix: string,
): DemoCatalog {
  const spec = THEMES[theme] ?? THEMES.default!;
  const rand = mulberry32(seed);
  const products: DemoProduct[] = [];
  const usedSlugs = new Set<string>();
  for (let i = 0; products.length < count && i < count * 20; i++) {
    const line = spec.lines[i % spec.lines.length]!;
    const brand = pick(rand, line.brands);
    const title = `${brand} ${pick(rand, line.adjectives)} ${pick(rand, line.nouns)}${rand() < 0.35 ? ` ${2 + Math.floor(rand() * 8)}` : ''}`;
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (usedSlugs.has(slug)) continue;
    usedSlugs.add(slug);
    const base = line.price[0] + Math.floor(rand() * (line.price[1] - line.price[0]));
    const color = line.colors ? pick(rand, line.colors) : null;
    const axisValues = line.variantAxis.values.filter(() => rand() < 0.8);
    const values = axisValues.length > 0 ? axisValues : [line.variantAxis.values[0]!];
    const onSale = rand() < 0.2;
    const index = products.length + 1;
    const variants: DemoVariant[] = values.map((value, vi) => {
      const price = roundPrice(
        base * (1 + vi * (line.variantAxis.name === 'weight' || line.variantAxis.name === 'pack' ? 0.8 : 0)),
      );
      return {
        sku: `${skuPrefix}-${String(index).padStart(4, '0')}-${vi + 1}`,
        title: color ? `${value} / ${color}` : value,
        priceCents: price,
        compareAtCents: onSale ? roundPrice(price * 1.25) : null,
        attributes: { [line.variantAxis.name]: value, ...(color ? { color } : {}) },
        onHand: rand() < 0.08 ? Math.floor(rand() * 3) : 5 + Math.floor(rand() * 60),
      };
    });
    const attributes: Record<string, unknown> = {};
    for (const [key, options] of Object.entries(line.attributes)) attributes[key] = pick(rand, options);
    products.push({
      title,
      slug,
      description: `**${title}** by ${brand}.\n\nDesigned for ${line.tags.join(', ')}. ${pick(rand, [
        'Lightweight and durable.',
        'Loved by our community.',
        'A customer favourite.',
        'New this season.',
        'Built to last.',
      ])}`,
      brand,
      categorySlug: line.category,
      attributes,
      tags: [...line.tags],
      status: rand() < 0.95 ? 'active' : 'draft',
      variants,
    });
  }
  return { categories: spec.categories.map((c) => ({ ...c })), products };
}
