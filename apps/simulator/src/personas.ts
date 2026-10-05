import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

export const TONE_KEYS = ['performance', 'lifestyle', 'value', 'premium'] as const;

export const personaSchema = z.object({
  key: z.string().regex(/^[a-z_]+$/),
  share: z.number().min(0),
  categories: z.record(z.string(), z.number().min(0)),
  price: z.object({ mean: z.number().positive(), sd: z.number().positive() }),
  session: z.object({
    pages_mean: z.number().positive(),
    add_to_cart_p: z.number().min(0).max(1),
    checkout_p: z.number().min(0).max(1),
    purchase_p: z.number().min(0).max(1),
  }),
  return_rate: z.number().min(0).max(1),
  register_p: z.number().min(0).max(1),
  discount_p: z.number().min(0).max(1).default(0),
  base_ctr: z.number().min(0).max(1),
  tone_multipliers: z.record(z.string(), z.number().min(0)),
});

export type Persona = z.infer<typeof personaSchema>;

const fileSchema = z.object({ personas: z.array(personaSchema).min(1) });

const here = dirname(fileURLToPath(import.meta.url));

export function personasPath(): string {
  const candidates = [
    join(here, '..', 'personas.yaml'),
    join(here, 'personas.yaml'),
    join(here, '..', '..', 'personas.yaml'),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

export function parsePersonas(text: string): Persona[] {
  return fileSchema.parse(parse(text)).personas;
}

export function loadPersonas(path = process.env.SIM_PERSONAS_FILE ?? personasPath()): Persona[] {
  return parsePersonas(readFileSync(path, 'utf8'));
}

export function trueBestTone(multipliers: Record<string, number>): string {
  return (
    Object.entries(multipliers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    'performance'
  );
}
