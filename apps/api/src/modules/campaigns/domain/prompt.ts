import { createHash } from 'node:crypto';
import { z } from 'zod';

export const CREATIVE_PROMPT_VERSION = 'creative.v1';

export const creativeOutputSchema = z.object({
  variants: z
    .array(
      z.object({
        headline: z.string().min(1),
        body: z.string().min(1),
        cta: z.string().min(1),
        tone: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .min(1)
    .max(10),
});
export type CreativeOutput = z.infer<typeof creativeOutputSchema>;

export const CREATIVE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['variants'],
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'body', 'cta', 'tone', 'rationale'],
        properties: {
          headline: { type: 'string', description: 'At most 60 characters' },
          body: { type: 'string', description: 'At most 160 characters' },
          cta: { type: 'string', description: 'At most 24 characters' },
          tone: { type: 'string', enum: ['performance', 'lifestyle', 'value', 'premium'] },
          rationale: { type: 'string', description: 'One sentence: why this variant fits the segment' },
        },
      },
    },
  },
};

export interface PromptProduct {
  title: string;
  brand: string | null;
  category: string | null;
  attributes: Record<string, unknown>;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  description: string;
}

export interface CreativePromptInput {
  storeName: string;
  brandVoice: string;
  language: string;
  currency: string;
  segment: { key: string; name: string; rules: string; aggregates: string[] };
  tones: string[];
  count: number;
  products: PromptProduct[];
  discounts: Array<{ code: string; type: string; value: number }>;
  bannedClaims: string[];
}

function money(cents: number | null, currency: string): string {
  if (cents === null) return 'n/a';
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function sanitizeUntrusted(text: string): string {
  return text
    .replace(/<\/?untrusted_product_data[^>]*>/gi, '')
    .replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : ' '))
    .slice(0, 500);
}

export function promptVariables(input: CreativePromptInput): Record<string, string> {
  const products = input.products
    .map((p, i) => {
      const attributes = Object.entries(p.attributes)
        .filter(([, v]) => typeof v !== 'object')
        .slice(0, 6)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ');
      return `${i + 1}. ${p.title}${p.brand ? ` (${p.brand})` : ''}; category ${p.category ?? 'n/a'}; price ${money(p.priceMinCents, input.currency)}${p.priceMaxCents && p.priceMaxCents !== p.priceMinCents ? ` – ${money(p.priceMaxCents, input.currency)}` : ''}${attributes ? `; ${attributes}` : ''}`;
    })
    .join('\n');
  const untrusted = input.products
    .map((p, i) => `[product ${i + 1}] ${sanitizeUntrusted(p.description)}`)
    .join('\n');
  return {
    storeName: input.storeName,
    brandVoice: input.brandVoice || 'friendly, confident, no hype',
    language: input.language,
    currency: input.currency,
    segmentKey: input.segment.key,
    segmentName: input.segment.name,
    segmentRules: input.segment.rules,
    segmentAggregates: input.segment.aggregates.map((a) => `- ${a}`).join('\n') || '- no aggregated data yet',
    tones: input.tones.join(', '),
    count: String(input.count),
    products,
    untrustedProducts: untrusted,
    discounts:
      input.discounts.length > 0
        ? input.discounts
            .map(
              (d) =>
                `${d.code}: ${d.type === 'percent' ? `${d.value}% off` : `${money(d.value, input.currency)} off`}`,
            )
            .join('; ')
        : 'none — do not mention any discount or percentage',
    bannedClaims: input.bannedClaims.join(', ') || 'none',
  };
}

export function inputHash(parts: {
  promptVersion: string;
  model: string;
  system: string;
  prompt: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([parts.promptVersion, parts.model, parts.system, parts.prompt, CREATIVE_JSON_SCHEMA]),
    )
    .digest('hex');
}

export { splitPromptFile } from '../../../shared/llm/prompt-files';
