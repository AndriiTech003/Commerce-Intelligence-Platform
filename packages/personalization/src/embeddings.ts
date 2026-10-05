import { hashString } from './random';

export const EMBEDDING_DIMENSIONS = 384;

export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function dot(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vector.map((v) => v / norm) : vector;
}

export function fitDimensions(vector: number[], dimensions = EMBEDDING_DIMENSIONS): number[] {
  if (vector.length === dimensions) return normalize(vector);
  if (vector.length > dimensions) return normalize(vector.slice(0, dimensions));
  return normalize([...vector, ...new Array<number>(dimensions - vector.length).fill(0)]);
}

export interface EmbeddingSource {
  title: string;
  brand?: string | null;
  categoryPath?: string | null;
  attributes?: Record<string, unknown>;
  tags?: string[];
  description?: string | null;
}

export function embeddingText(source: EmbeddingSource): string {
  const attributes = Object.entries(source.attributes ?? {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
  const description = (source.description ?? '')
    .replace(/[*_`#>[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return [
    source.title,
    source.brand ?? '',
    (source.categoryPath ?? '').replace(/[._]/g, ' '),
    [attributes, (source.tags ?? []).join(' ')].filter(Boolean).join('; '),
    description,
  ].join(' | ');
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'by',
  'a',
  'an',
  'of',
  'to',
  'in',
  'is',
  'our',
  'your',
  'this',
]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function hashEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const words = tokens(text);
  const features: Array<[string, number]> = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    features.push([`w:${word}`, 1]);
    if (word.length > 4)
      for (let j = 0; j + 4 <= word.length; j++) features.push([`g:${word.slice(j, j + 4)}`, 0.35]);
    if (i + 1 < words.length) features.push([`b:${word}_${words[i + 1]}`, 0.6]);
  }
  for (const [feature, weight] of features) {
    const h = hashString(feature);
    const index = h % dimensions;
    const sign = (hashString(`s:${feature}`) & 1) === 0 ? 1 : -1;
    vector[index]! += sign * weight;
  }
  return normalize(vector);
}

export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')}]`;
}

export function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw !== 'string' || raw.length < 2) return null;
  return raw.slice(1, -1).split(',').filter(Boolean).map(Number);
}
