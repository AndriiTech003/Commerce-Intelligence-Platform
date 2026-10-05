import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { uuidv7 } from '@cip/contracts';
import { createLogger } from '@cip/observability';
import { sql } from 'drizzle-orm';
import { AppModule } from './app.module';
import type { ApiConfig } from './config';
import { createDatabase, databaseName, dropDatabase, runMigrations } from './db/migrate';
import { DemoCatalogService, generateDemoCatalog } from './modules/catalog';
import { AuthService, PASSWORD_HASHER, type PasswordHasher } from './modules/identity';
import { TenantDatabase } from './modules/tenancy';
import { CampaignService, CreativeService } from './modules/campaigns';
import { SegmentService } from './modules/personalization';
import { EMBEDDINGS } from './shared/tokens';
import { newContext, runWithContext } from './shared/request-context';
import { embeddingText, vectorLiteral, type EmbeddingProvider } from '@cip/personalization';
import { createHash } from 'node:crypto';

export const DEMO_PASSWORD = 'demo1234';

export interface SeedTenant {
  slug: string;
  name: string;
  currency: string;
  theme: string;
  products: number;
  seed: number;
  skuPrefix: string;
  brandColor: string;
  tagline: string;
  owner: string;
  staff: Array<{ email: string; name: string; role: string }>;
  customers: Array<{ email: string; name: string }>;
  discounts: Array<{ code: string; type: 'percent' | 'fixed'; value: number; minSubtotalCents: number }>;
}

export const SEED_TENANTS: SeedTenant[] = [
  {
    slug: 'runhub',
    name: 'RunHub',
    currency: 'USD',
    theme: 'runhub',
    products: 300,
    seed: 20260101,
    skuPrefix: 'RH',
    brandColor: '#ea580c',
    tagline: 'Gear for every mile',
    owner: 'owner@runhub.dev',
    staff: [
      { email: 'catalog@runhub.dev', name: 'Cathy Catalog', role: 'catalog_manager' },
      { email: 'support@runhub.dev', name: 'Sam Support', role: 'support' },
      { email: 'marketer@runhub.dev', name: 'Mia Marketer', role: 'marketer' },
    ],
    customers: [{ email: 'customer@runhub.dev', name: 'Riley Runner' }],
    discounts: [
      { code: 'WELCOME10', type: 'percent', value: 10, minSubtotalCents: 0 },
      { code: 'TRAIL20', type: 'fixed', value: 2000, minSubtotalCents: 10000 },
    ],
  },
  {
    slug: 'homebrew',
    name: 'HomeBrew',
    currency: 'EUR',
    theme: 'homebrew',
    products: 150,
    seed: 20260202,
    skuPrefix: 'HB',
    brandColor: '#7c2d12',
    tagline: 'Coffee and gear for the home barista',
    owner: 'owner@homebrew.dev',
    staff: [{ email: 'support@homebrew.dev', name: 'Hugo Support', role: 'support' }],
    customers: [{ email: 'customer@homebrew.dev', name: 'Bea Barista' }],
    discounts: [{ code: 'BREW15', type: 'percent', value: 15, minSubtotalCents: 3000 }],
  },
];

export const DEMO_SEGMENTS = [
  {
    key: 'premium_shoppers',
    name: 'Premium shoppers',
    priority: 45,
    rules: { all: [{ feature: 'price.ewma_cents', op: 'gte', value: 25000 }] },
  },
  {
    key: 'runners',
    name: 'Runners',
    priority: 70,
    rules: { all: [{ feature: 'aff.cat.running', op: 'gte', value: 3 }] },
  },
  {
    key: 'hikers',
    name: 'Hikers',
    priority: 71,
    rules: { all: [{ feature: 'aff.cat.hiking', op: 'gte', value: 3 }] },
  },
];

export const DEMO_TONES = ['performance', 'lifestyle', 'value', 'premium'] as const;

const MANUAL_BY_TONE: Record<string, { headline: string; body: string; cta: string }> = {
  performance: {
    headline: 'Built for your next PR',
    body: 'Lightweight, responsive gear made for faster miles.',
    cta: 'Shop performance',
  },
  lifestyle: {
    headline: 'Gear that fits your weekend',
    body: 'Comfortable picks that go from trail to café.',
    cta: 'Explore the look',
  },
  value: {
    headline: 'Smart picks, real value',
    body: 'Quality running gear without overspending.',
    cta: 'See the deals',
  },
  premium: {
    headline: 'Crafted for the discerning',
    body: 'Premium materials and meticulous detail, made to last.',
    cta: 'Discover premium',
  },
};

export async function embedProducts(db: TenantDatabase, provider: EmbeddingProvider): Promise<number> {
  const rows = (
    await db.system.execute(sql`
      select p.id, p.title, p.brand, p.description, p.attributes, p.tags, c.path::text as category_path
      from products p left join categories c on c.id = p.category_id
      where p.embedding is null or p.embedding_version is distinct from ${provider.version}`)
  ).rows as Array<{
    id: string;
    title: string;
    brand: string | null;
    description: string;
    attributes: Record<string, unknown>;
    tags: string[];
    category_path: string | null;
  }>;
  for (let i = 0; i < rows.length; i += 64) {
    const chunk = rows.slice(i, i + 64);
    const texts = chunk.map((r) =>
      embeddingText({
        title: r.title,
        brand: r.brand,
        categoryPath: r.category_path,
        attributes: r.attributes,
        tags: r.tags,
        description: r.description,
      }),
    );
    const vectors = await provider.embed(texts, 'document');
    for (let j = 0; j < chunk.length; j++) {
      const hash = createHash('sha1').update(texts[j]!).digest('hex');
      await db.system.execute(
        sql`update products set embedding = ${vectorLiteral(vectors[j]!)}::vector, embedding_version = ${provider.version}, embedding_source_hash = ${hash} where id = ${chunk[j]!.id}`,
      );
    }
  }
  return rows.length;
}

async function seedDemoCampaign(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  tenantId: string,
  marketerId: string,
): Promise<{ name: string; creatives: number }> {
  const ctx = newContext({
    requestId: 'seed',
    tenantId,
    actor: { type: 'user', id: marketerId, permissions: [], role: 'marketer' },
  });
  return runWithContext(ctx, async () => {
    const segments = app.get(SegmentService);
    for (const segment of DEMO_SEGMENTS) await segments.create(tenantId, segment).catch(() => undefined);
    const campaigns = app.get(CampaignService);
    const creatives = app.get(CreativeService);
    const created = await campaigns.create({
      name: 'Spring running push',
      placement: 'home_hero',
      targetSegments: ['price_sensitive', 'premium_shoppers', 'runners', 'hikers'],
      productSelector: {},
      goal: 'click',
    });
    const generated = await creatives.generate(created.id, {
      segments: ['runners'],
      tones: [...DEMO_TONES],
      count: 4,
      async: false,
    });
    const approvedTones = new Set<string>();
    for (const creative of generated.creatives) {
      if (!creative.tone || approvedTones.has(creative.tone)) continue;
      const blocked = creative.guardrailFlags.some((f) =>
        ['unverified_claim', 'prompt_injection', 'too_long', 'profanity'].includes(f),
      );
      if (blocked) continue;
      await creatives.review(creative.id, 'approve', 'Seeded demo approval');
      approvedTones.add(creative.tone);
    }
    for (const tone of DEMO_TONES) {
      if (approvedTones.has(tone)) continue;
      const manual = await creatives.createManual(created.id, {
        ...MANUAL_BY_TONE[tone]!,
        tone,
        targetSegment: null,
      });
      await creatives.review(manual.id, 'approve', 'Seeded demo approval');
    }
    await campaigns.update(created.id, { status: 'active' });
    return { name: created.name, creatives: DEMO_TONES.length };
  });
}

export async function seed(
  config: ApiConfig,
  options: { reset: boolean; log?: (message: string) => void; demoCampaign?: boolean },
) {
  const log = options.log ?? (() => undefined);
  const name = databaseName(config.DATABASE_ADMIN_URL);
  if (options.reset) {
    await dropDatabase(config.DATABASE_ADMIN_URL, name);
    log(`dropped database ${name}`);
  }
  await createDatabase(config.DATABASE_ADMIN_URL, name);
  await runMigrations(config.DATABASE_ADMIN_URL);
  log('migrations applied');
  const logger = createLogger('seed', { level: 'warn' });
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ ...config, CONSUMERS_ENABLED: false }, logger),
    {
      logger: ['error'],
    },
  );
  try {
    const db = app.get(TenantDatabase);
    const auth = app.get(AuthService);
    const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);
    const catalog = app.get(DemoCatalogService);
    const passwordHash = await hasher.hash(DEMO_PASSWORD);
    const existing = await db.app.execute(sql`select slug from tenants`);
    const present = new Set((existing.rows as Array<{ slug: string }>).map((r) => r.slug));
    const userIds = new Map<string, string>();
    const ensureUser = async (email: string, displayName: string, platformAdmin = false) => {
      const found = await db.app.execute(sql`select id from users where email = ${email}`);
      const row = found.rows[0] as { id: string } | undefined;
      if (row) return row.id;
      const id = uuidv7();
      await db.app.execute(
        sql`insert into users (id, email, name, password_hash, is_platform_admin) values (${id}, ${email}, ${displayName}, ${passwordHash}, ${platformAdmin})`,
      );
      return id;
    };
    const summary: Array<{ slug: string; tenantId: string; products: number }> = [];
    for (const tenant of SEED_TENANTS) {
      if (present.has(tenant.slug)) {
        log(`tenant ${tenant.slug} exists, skipping`);
        continue;
      }
      const session = await auth.signup({
        email: tenant.owner,
        password: DEMO_PASSWORD,
        name: `${tenant.name} Owner`,
        storeName: tenant.name,
        storeSlug: tenant.slug,
        currency: tenant.currency,
        demoCatalog: false,
      });
      const tenantId = session.tenantId;
      userIds.set(tenant.owner, session.user.id);
      const products = await db.withTenant(tenantId, async (tx) => {
        await tx.execute(
          sql`update tenants set settings = settings || ${JSON.stringify({ brandColor: tenant.brandColor, tagline: tenant.tagline, lowStockThreshold: 3 })}::jsonb where id = ${tenantId}`,
        );
        for (const staff of tenant.staff) {
          const userId = await ensureUser(staff.email, staff.name);
          await tx.execute(
            sql`insert into memberships (tenant_id, user_id, role) values (${tenantId}, ${userId}, ${staff.role}) on conflict do nothing`,
          );
        }
        for (const customer of tenant.customers) {
          await tx.execute(
            sql`insert into customers (id, tenant_id, email, name, password_hash) values (${uuidv7()}, ${tenantId}, ${customer.email}, ${customer.name}, ${passwordHash})`,
          );
        }
        for (const discount of tenant.discounts) {
          await tx.execute(
            sql`insert into discounts (id, tenant_id, code, type, value, min_subtotal_cents, active) values (${uuidv7()}, ${tenantId}, ${discount.code}, ${discount.type}, ${discount.value}, ${discount.minSubtotalCents}, true)`,
          );
        }
        return catalog.load(
          generateDemoCatalog(tenant.theme, tenant.products, tenant.seed, tenant.skuPrefix),
          tenant.currency,
        );
      });
      summary.push({ slug: tenant.slug, tenantId, products });
      log(`seeded ${tenant.slug}: ${products} products`);
    }
    const demoId = await ensureUser('demo@cip.dev', 'Demo Merchant');
    const platformId = await ensureUser('platform@cip.dev', 'Platform Admin', true);
    const tenants = await db.app.execute(
      sql`select id, slug from tenants where slug in ('runhub', 'homebrew')`,
    );
    for (const row of tenants.rows as Array<{ id: string; slug: string }>) {
      await db.withTenant(row.id, async (tx) => {
        await tx.execute(
          sql`insert into memberships (tenant_id, user_id, role) values (${row.id}, ${demoId}, ${row.slug === 'runhub' ? 'owner' : 'admin'}) on conflict do nothing`,
        );
      });
    }
    log(`platform admin: platform@cip.dev (${platformId}), multi-store user: demo@cip.dev`);
    const embedded = await embedProducts(db, app.get<EmbeddingProvider>(EMBEDDINGS));
    log(`embedded ${embedded} products with ${app.get<EmbeddingProvider>(EMBEDDINGS).version}`);
    if (options.demoCampaign !== false) {
      const runhub = summary.find((t) => t.slug === 'runhub');
      const marketer = await ensureUser('marketer@runhub.dev', 'Mia Marketer');
      if (runhub) {
        const campaign = await seedDemoCampaign(app, runhub.tenantId, marketer);
        log(`demo campaign ${campaign.name}: ${campaign.creatives} active creatives`);
      }
    }
    return summary;
  } finally {
    await app.close();
  }
}
