import { cosine } from '@cip/personalization';

export const LIMITS = { headline: 60, body: 160, cta: 24 } as const;
export const NEAR_DUPLICATE_THRESHOLD = 0.92;

export type GuardrailFlag =
  | 'too_long'
  | 'unverified_claim'
  | 'banned_claim'
  | 'profanity'
  | 'near_duplicate'
  | 'language_mismatch'
  | 'prompt_injection';

export const REJECTING_FLAGS: readonly GuardrailFlag[] = ['too_long', 'profanity'];
export const APPROVAL_BLOCKING: readonly GuardrailFlag[] = [
  'too_long',
  'profanity',
  'unverified_claim',
  'prompt_injection',
];

export interface CreativeText {
  headline: string;
  body: string;
  cta: string;
}

export interface GuardrailContext {
  priceCents: number[];
  compareAtSavingsCents?: number[];
  discounts: Array<{ code: string; type: 'percent' | 'fixed'; value: number }>;
  bannedClaims: string[];
  language: string;
  embedding?: number[] | null;
  existing?: Array<{ id: string; embedding: number[] }>;
  untrusted?: string[];
}

export interface GuardrailResult {
  flags: GuardrailFlag[];
  details: string[];
  rejected: boolean;
}

const PROFANITY = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'dick',
  'crap',
  'damn',
  'piss',
  'scheiße',
  'scheisse',
  'merde',
  'mierda',
];

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /system prompt/i,
  /you are now/i,
  /<\/?untrusted/i,
];

const MONEY =
  /(?:[$€£]\s?(\d{1,6}(?:[.,]\d{1,2})?))|(?:(\d{1,6}(?:[.,]\d{1,2})?)\s?(?:usd|eur|gbp|dollars?|euros?|€|\$|£))/gi;
const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s?(?:%|percent\b|per cent\b)/gi;

function amountToCents(raw: string): number {
  return Math.round(Number(raw.replace(',', '.')) * 100);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const STOPWORDS: Record<string, string[]> = {
  en: [
    'the',
    'and',
    'for',
    'your',
    'with',
    'you',
    'our',
    'to',
    'of',
    'on',
    'is',
    'every',
    'from',
    'this',
    'now',
    'in',
    'it',
    'more',
    'all',
    'get',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'für',
    'mit',
    'ihr',
    'ihre',
    'jetzt',
    'ist',
    'nicht',
    'auf',
    'zu',
    'ein',
    'eine',
    'den',
    'dein',
    'deine',
    'sie',
    'mehr',
  ],
  fr: [
    'le',
    'la',
    'les',
    'et',
    'pour',
    'avec',
    'votre',
    'vos',
    'est',
    'une',
    'des',
    'du',
    'sur',
    'pas',
    'plus',
    'dans',
    'nous',
    'vous',
  ],
  es: [
    'el',
    'la',
    'los',
    'las',
    'y',
    'para',
    'con',
    'tu',
    'tus',
    'es',
    'una',
    'del',
    'por',
    'más',
    'ahora',
    'que',
    'nuestro',
  ],
  it: [
    'il',
    'lo',
    'gli',
    'e',
    'per',
    'con',
    'tuo',
    'tua',
    'è',
    'una',
    'del',
    'della',
    'più',
    'ora',
    'che',
    'nostro',
  ],
};

export function detectLanguage(text: string): { language: string | null; confidence: number } {
  const tokens = words(text);
  if (tokens.length < 4) return { language: null, confidence: 0 };
  const scores = Object.entries(STOPWORDS).map(([lang, list]) => {
    const set = new Set(list);
    return [lang, tokens.filter((t) => set.has(t)).length] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] < 2) return { language: null, confidence: 0 };
  return { language: best[0], confidence: (best[1] - (second?.[1] ?? 0)) / tokens.length };
}

export function verifyClaims(text: string, ctx: GuardrailContext): string[] {
  const problems: string[] = [];
  const allowedAmounts = new Set<number>([
    ...ctx.priceCents,
    ...(ctx.compareAtSavingsCents ?? []),
    ...ctx.discounts.filter((d) => d.type === 'fixed').map((d) => d.value),
  ]);
  const allowedPercents = new Set<number>(
    ctx.discounts.filter((d) => d.type === 'percent').map((d) => d.value),
  );
  for (const match of text.matchAll(MONEY)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const cents = amountToCents(raw);
    const ok = [...allowedAmounts].some(
      (a) => Math.abs(a - cents) <= 1 || Math.abs(Math.round(a / 100) * 100 - cents) === 0,
    );
    if (!ok) problems.push(`price claim "${match[0].trim()}" does not match any real price or discount`);
  }
  for (const match of text.matchAll(PERCENT)) {
    const value = Number(match[1]!.replace(',', '.'));
    if (!allowedPercents.has(value))
      problems.push(`percent claim "${match[0].trim()}" does not match an active discount`);
  }
  return problems;
}

export function checkGuardrails(creative: CreativeText, ctx: GuardrailContext): GuardrailResult {
  const flags = new Set<GuardrailFlag>();
  const details: string[] = [];
  for (const field of ['headline', 'body', 'cta'] as const) {
    if (creative[field].length > LIMITS[field]) {
      flags.add('too_long');
      details.push(`${field} has ${creative[field].length} characters (max ${LIMITS[field]})`);
    }
    if (creative[field].trim().length === 0) {
      flags.add('too_long');
      details.push(`${field} is empty`);
    }
  }
  const text = `${creative.headline}\n${creative.body}\n${creative.cta}`;
  const lower = text.toLowerCase();
  const claims = verifyClaims(text, ctx);
  if (claims.length > 0) {
    flags.add('unverified_claim');
    details.push(...claims);
  }
  for (const claim of ctx.bannedClaims) {
    const needle = claim.toLowerCase().trim();
    if (needle && lower.includes(needle)) {
      flags.add('banned_claim');
      details.push(`banned claim "${claim}"`);
    }
  }
  const tokens = new Set(words(text));
  const profane = PROFANITY.filter((w) => tokens.has(w));
  if (profane.length > 0) {
    flags.add('profanity');
    details.push(`profanity: ${profane.join(', ')}`);
  }
  if (INJECTION_PATTERNS.some((p) => p.test(text))) {
    flags.add('prompt_injection');
    details.push('output contains prompt-injection phrasing');
  }
  for (const source of ctx.untrusted ?? []) {
    const match =
      /ignore (all )?(previous|prior|above) instructions[^a-z0-9]*(?:and )?(?:write|say|add)?:?\s*([^\n]{6,})/i.exec(
        source,
      );
    const payload = match?.[3]?.trim().toLowerCase().slice(0, 40);
    if (payload && payload.length >= 6 && lower.includes(payload.slice(0, Math.min(payload.length, 24)))) {
      flags.add('prompt_injection');
      details.push('output repeats instructions injected through product data');
    }
  }
  if (ctx.embedding && ctx.existing?.length) {
    let best = 0;
    let bestId = '';
    for (const other of ctx.existing) {
      const similarity = cosine(ctx.embedding, other.embedding);
      if (similarity > best) {
        best = similarity;
        bestId = other.id;
      }
    }
    if (best > NEAR_DUPLICATE_THRESHOLD) {
      flags.add('near_duplicate');
      details.push(`near duplicate of creative ${bestId} (cosine ${best.toFixed(3)})`);
    }
  }
  const detected = detectLanguage(text);
  if (detected.language && detected.language !== ctx.language && detected.confidence > 0.05) {
    flags.add('language_mismatch');
    details.push(`text looks like "${detected.language}" but the store language is "${ctx.language}"`);
  }
  const list = [...flags];
  return { flags: list, details, rejected: list.some((f) => REJECTING_FLAGS.includes(f)) };
}

export function blocksApproval(flags: readonly string[]): string[] {
  return flags.filter((f) => (APPROVAL_BLOCKING as readonly string[]).includes(f));
}
