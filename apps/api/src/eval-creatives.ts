import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cosine, hashEmbedding } from '@cip/personalization';
import { loadConfig } from './config';
import {
  blocksApproval,
  checkGuardrails,
  CREATIVE_PROMPT_VERSION,
  creativeOutputSchema,
  promptVariables,
  type CreativeOutput,
} from './modules/campaigns';
import { CREATIVE_JSON_SCHEMA } from './modules/campaigns/domain/prompt';
import { createLlmClient } from './shared/llm/factory';
import { extractJson, renderTemplate } from './shared/llm/llm';
import { loadPromptFile, splitPromptFile } from './shared/llm/prompt-files';

interface Fixture {
  id: string;
  campaign: string;
  segment: { key: string; name: string; rules: string; aggregates: string[] };
  tones: string[];
  count: number;
  products: Array<{
    title: string;
    brand: string;
    category: string;
    priceMinCents: number;
    priceMaxCents: number;
    description: string;
    attributes: Record<string, unknown>;
  }>;
  discounts: Array<{ code: string; type: 'percent' | 'fixed'; value: number }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = [join(here, '..'), join(here, '..', '..')].find((d) => {
  try {
    readFileSync(join(d, 'eval', 'creatives.fixtures.json'));
    return true;
  } catch {
    return false;
  }
})!;
const file = JSON.parse(readFileSync(join(root, 'eval', 'creatives.fixtures.json'), 'utf8')) as {
  store: { name: string; brandVoice: string; language: string; currency: string; bannedClaims: string[] };
  fixtures: Fixture[];
};
const config = loadConfig();
const llm = createLlmClient(config);
const template = splitPromptFile(await loadPromptFile(CREATIVE_PROMPT_VERSION));

const rows: string[] = [];
const totals = {
  variants: 0,
  rejected: 0,
  approvable: 0,
  flagged: 0,
  duplicates: 0,
  invalid: 0,
  retries: 0,
  headline: 0,
  body: 0,
  cta: 0,
  latency: 0,
  cost: 0,
  inTok: 0,
  outTok: 0,
};
const flagCounts: Record<string, number> = {};

for (const fixture of file.fixtures) {
  const variables = promptVariables({
    storeName: file.store.name,
    brandVoice: file.store.brandVoice,
    language: file.store.language,
    currency: file.store.currency,
    segment: fixture.segment,
    tones: fixture.tones,
    count: fixture.count,
    products: fixture.products.map((p) => ({ ...p, category: p.category })),
    discounts: fixture.discounts,
    bannedClaims: file.store.bannedClaims,
  });
  const system = renderTemplate(template.system, variables);
  let prompt = renderTemplate(template.user, variables);
  let output: CreativeOutput | null = null;
  for (let attempt = 1; attempt <= 2 && !output; attempt++) {
    const response = await llm.complete({
      task: 'creative',
      system,
      prompt,
      schema: CREATIVE_JSON_SCHEMA,
      maxTokens: 2000,
      context: {
        storeName: file.store.name,
        products: fixture.products.map((p) => ({
          title: p.title,
          priceCents: p.priceMinCents,
          brand: p.brand,
        })),
        tones: fixture.tones,
        count: fixture.count,
        currency: file.store.currency,
        discounts: fixture.discounts,
        untrusted: variables.untrustedProducts,
        segmentKey: fixture.segment.key,
      },
    });
    totals.latency += response.latencyMs;
    totals.cost += response.costUsd;
    totals.inTok += response.inputTokens;
    totals.outTok += response.outputTokens;
    let parsed: ReturnType<typeof creativeOutputSchema.safeParse>;
    try {
      parsed = creativeOutputSchema.safeParse(extractJson(response.text));
    } catch {
      parsed = creativeOutputSchema.safeParse(null);
    }
    if (parsed.success) output = parsed.data;
    else {
      totals.retries += 1;
      prompt += `\n\nYour previous answer failed validation: ${parsed.error.issues[0]?.message ?? 'invalid'}. Return only JSON.`;
    }
  }
  if (!output) {
    totals.invalid += 1;
    rows.push(
      `| ${fixture.id} | ${fixture.campaign} | ${fixture.segment.key} | ${fixture.tones.join(',')} | invalid output | | | |`,
    );
    continue;
  }
  const prices = fixture.products.flatMap((p) => [p.priceMinCents, p.priceMaxCents]);
  const existing: Array<{ id: string; embedding: number[] }> = [];
  let passed = 0;
  const fixtureFlags = new Set<string>();
  for (const [index, variant] of output.variants.entries()) {
    const embedding = hashEmbedding(`${variant.headline} ${variant.body}`);
    const result = checkGuardrails(variant, {
      priceCents: prices,
      discounts: fixture.discounts,
      bannedClaims: file.store.bannedClaims,
      language: file.store.language,
      embedding,
      existing: [...existing],
      untrusted: fixture.products.map((p) => p.description),
    });
    existing.push({ id: `v${index}`, embedding });
    totals.variants += 1;
    totals.headline += variant.headline.length;
    totals.body += variant.body.length;
    totals.cta += variant.cta.length;
    if (result.rejected) totals.rejected += 1;
    else if (blocksApproval(result.flags).length === 0) {
      totals.approvable += 1;
      passed += 1;
    }
    if (result.flags.length > 0) totals.flagged += 1;
    if (result.flags.includes('near_duplicate')) totals.duplicates += 1;
    for (const flag of result.flags) {
      flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
      fixtureFlags.add(flag);
    }
  }
  let maxSim = 0;
  for (let i = 0; i < existing.length; i++)
    for (let j = i + 1; j < existing.length; j++)
      maxSim = Math.max(maxSim, cosine(existing[i]!.embedding, existing[j]!.embedding));
  rows.push(
    `| ${fixture.id} | ${fixture.campaign} | ${fixture.segment.key} | ${fixture.tones.join(',')} | ${passed}/${output.variants.length} | ${[...fixtureFlags].join(', ') || '—'} | ${maxSim.toFixed(2)} | ${output.variants[0]!.headline.replace(/\|/g, '/')} |`,
  );
}

const pct = (n: number) => `${((n / Math.max(1, totals.variants)) * 100).toFixed(1)}%`;
const report = [
  `# Creative generation eval (${CREATIVE_PROMPT_VERSION})`,
  '',
  `Provider: ${llm.provider} · model: ${llm.model} · fixtures: ${file.fixtures.length} · variants: ${totals.variants} · generated ${new Date().toISOString()}`,
  '',
  '| Metric | Value |',
  '|---|---|',
  `| Variants passing guardrails and approvable | ${totals.approvable} (${pct(totals.approvable)}) |`,
  `| Rejected (length / profanity) | ${totals.rejected} (${pct(totals.rejected)}) |`,
  `| Variants with any flag | ${totals.flagged} (${pct(totals.flagged)}) |`,
  `| Near-duplicates (cos > 0.92 within a fixture) | ${totals.duplicates} (${pct(totals.duplicates)}) |`,
  `| Invalid outputs after one retry | ${totals.invalid} · retries used: ${totals.retries} |`,
  `| Average length headline / body / cta | ${(totals.headline / Math.max(1, totals.variants)).toFixed(1)} / ${(totals.body / Math.max(1, totals.variants)).toFixed(1)} / ${(totals.cta / Math.max(1, totals.variants)).toFixed(1)} chars |`,
  `| Flags | ${
    Object.entries(flagCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || '—'
  } |`,
  `| Tokens in / out | ${totals.inTok} / ${totals.outTok} |`,
  `| Total LLM latency / cost | ${totals.latency} ms / $${totals.cost.toFixed(4)} |`,
  '',
  '| Fixture | Campaign | Segment | Tone | Approvable | Flags | Max cos | First headline |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
].join('\n');

const out = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(root, 'eval', 'results.md');
if (out) writeFileSync(out, report);
console.log(report);
