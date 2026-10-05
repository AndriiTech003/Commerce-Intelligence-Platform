import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const ltree = customType<{ data: string }>({
  dataType: () => 'ltree',
});

export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

export const inet = customType<{ data: string }>({
  dataType: () => 'inet',
});

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('tenants_slug_check', sql`${t.slug} ~ '^[a-z0-9-]{3,32}$'`),
    check('tenants_status_check', sql`${t.status} in ('active','suspended')`),
  ],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    check(
      'memberships_role_check',
      sql`${t.role} in ('owner','admin','catalog_manager','marketer','support')`,
    ),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  email: citext('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by'),
  expiresAt: tz('expires_at').notNull(),
  acceptedAt: tz('accepted_at'),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    subjectId: uuid('subject_id').notNull(),
    subjectType: text('subject_type').notNull(),
    tenantId: uuid('tenant_id'),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tz('expires_at').notNull(),
    revokedAt: tz('revoked_at'),
    replacedBy: uuid('replaced_by'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('refresh_tokens_subject_type_check', sql`${t.subjectType} in ('user','customer')`),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdBy: uuid('created_by').references(() => users.id),
    lastUsedAt: tz('last_used_at'),
    revokedAt: tz('revoked_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [check('api_keys_kind_check', sql`${t.kind} in ('publishable','secret')`)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    diff: jsonb('diff').$type<Record<string, [unknown, unknown]>>(),
    ip: inet('ip'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt.desc())],
);

export const tenantCounters = pgTable(
  'tenant_counters',
  {
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.name] })],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    path: ltree('path').notNull(),
  },
  (t) => [
    unique('categories_tenant_slug_unique').on(t.tenantId, t.slug),
    index('categories_path_gist').using('gist', t.path),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    categoryId: uuid('category_id').references(() => categories.id),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    brand: text('brand'),
    status: text('status').notNull().default('draft'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(brand, '')), 'B') || setweight(to_tsvector('simple', coalesce(description, '')), 'C')`,
    ),
    embedding: vector('embedding', { dimensions: 384 }),
    embeddingVersion: text('embedding_version'),
    embeddingSourceHash: text('embedding_source_hash'),
    priceMinCents: money('price_min_cents'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('products_tenant_slug_unique').on(t.tenantId, t.slug),
    check('products_status_check', sql`${t.status} in ('draft','active','archived')`),
    index('products_search_tsv_idx').using('gin', t.searchTsv),
    index('products_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('products_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('products_tenant_status_category_idx').on(t.tenantId, t.status, t.categoryId),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    position: integer('position').notNull(),
    alt: text('alt'),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.position)],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    title: text('title').notNull(),
    priceCents: money('price_cents').notNull(),
    compareAtCents: money('compare_at_cents'),
    currency: char('currency', { length: 3 }).notNull(),
    attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    unique('product_variants_tenant_sku_unique').on(t.tenantId, t.sku),
    check('product_variants_price_check', sql`${t.priceCents} >= 0`),
    index('product_variants_product_idx').on(t.productId),
  ],
);

export const inventoryItems = pgTable(
  'inventory_items',
  {
    variantId: uuid('variant_id')
      .primaryKey()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    onHand: integer('on_hand').notNull(),
    reserved: integer('reserved').notNull().default(0),
  },
  (t) => [
    check('inventory_items_on_hand_check', sql`${t.onHand} >= 0`),
    check('inventory_items_reserved_check', sql`${t.reserved} >= 0`),
    check('inventory_items_reserved_le_on_hand', sql`${t.reserved} <= ${t.onHand}`),
  ],
);

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    status: text('status').notNull(),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [
    check('inventory_reservations_quantity_check', sql`${t.quantity} > 0`),
    check('inventory_reservations_status_check', sql`${t.status} in ('active','committed','released')`),
    index('inventory_reservations_active_expiry_idx')
      .on(t.expiresAt)
      .where(sql`status = 'active'`),
    index('inventory_reservations_order_idx').on(t.orderId),
  ],
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    referenceId: uuid('reference_id'),
    actorId: uuid('actor_id'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('inventory_movements_variant_idx').on(t.variantId, t.createdAt.desc())],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    email: citext('email').notNull(),
    name: text('name'),
    passwordHash: text('password_hash'),
    anonymousIds: uuid('anonymous_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('customers_tenant_email_unique').on(t.tenantId, t.email)],
);

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    anonymousId: uuid('anonymous_id'),
    status: text('status').notNull().default('active'),
    discountCode: text('discount_code'),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('carts_status_check', sql`${t.status} in ('active','converted','merged','abandoned')`),
    uniqueIndex('carts_active_customer_unique')
      .on(t.tenantId, t.customerId)
      .where(sql`status = 'active' and customer_id is not null`),
    uniqueIndex('carts_active_anonymous_unique')
      .on(t.tenantId, t.anonymousId)
      .where(sql`status = 'active' and anonymous_id is not null`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    quantity: integer('quantity').notNull(),
    addedPriceCents: money('added_price_cents'),
    addedAt: tz('added_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cartId, t.variantId] }),
    check('cart_items_quantity_check', sql`${t.quantity} between 1 and 99`),
  ],
);

export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    code: citext('code').notNull(),
    type: text('type').notNull(),
    value: money('value').notNull(),
    minSubtotalCents: money('min_subtotal_cents').notNull().default(0),
    startsAt: tz('starts_at'),
    endsAt: tz('ends_at'),
    usageLimit: integer('usage_limit'),
    perCustomerLimit: integer('per_customer_limit'),
    usedCount: integer('used_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('discounts_tenant_code_unique').on(t.tenantId, t.code),
    check('discounts_type_check', sql`${t.type} in ('percent','fixed')`),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    number: money('number').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    email: citext('email').notNull(),
    status: text('status').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    subtotalCents: money('subtotal_cents').notNull(),
    discountCents: money('discount_cents').notNull().default(0),
    shippingCents: money('shipping_cents').notNull().default(0),
    totalCents: money('total_cents').notNull(),
    discountCode: text('discount_code'),
    shippingAddress: jsonb('shipping_address').$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    attribution: jsonb('attribution').$type<Record<string, unknown>>(),
    profileId: uuid('profile_id'),
    placedAt: tz('placed_at').notNull().defaultNow(),
  },
  (t) => [
    unique('orders_tenant_number_unique').on(t.tenantId, t.number),
    unique('orders_tenant_idempotency_unique').on(t.tenantId, t.idempotencyKey),
    index('orders_tenant_placed_idx').on(t.tenantId, t.placedAt.desc()),
    index('orders_customer_idx').on(t.customerId),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    variantId: uuid('variant_id').notNull(),
    productId: uuid('product_id').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    skuSnapshot: text('sku_snapshot').notNull(),
    unitPriceCents: money('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    actorId: uuid('actor_id'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('order_status_history_order_idx').on(t.orderId, t.createdAt)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').notNull(),
    clientSecret: text('client_secret'),
    status: text('status').notNull(),
    amountCents: money('amount_cents').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('payments_provider_ref_unique').on(t.provider, t.providerRef),
    index('payments_order_idx').on(t.orderId),
  ],
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
    processedAt: tz('processed_at'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerEventId] })],
);

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    headers: jsonb('headers').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tz('created_at').notNull().defaultNow(),
    publishedAt: tz('published_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    index('outbox_unpublished_idx')
      .on(t.createdAt)
      .where(sql`published_at is null`),
  ],
);

export const processedMessages = pgTable(
  'processed_messages',
  {
    consumer: text('consumer').notNull(),
    messageId: uuid('message_id').notNull(),
    processedAt: tz('processed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.messageId] })],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    total: integer('total').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    errors: jsonb('errors').$type<Array<{ row: number; message: string }>>().notNull().default([]),
    createdBy: uuid('created_by'),
    createdAt: tz('created_at').notNull().defaultNow(),
    finishedAt: tz('finished_at'),
    result: jsonb('result').$type<Record<string, unknown>>(),
  },
  (t) => [check('jobs_status_check', sql`${t.status} in ('queued','running','completed','failed')`)],
);

export const segments = pgTable(
  'segments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull(),
    priority: integer('priority').notNull().default(100),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [unique('segments_tenant_key_unique').on(t.tenantId, t.key)],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    placement: text('placement').notNull(),
    status: text('status').notNull(),
    targetSegments: text('target_segments').array().notNull(),
    productSelector: jsonb('product_selector').$type<Record<string, unknown>>().notNull(),
    goal: text('goal').notNull(),
    startsAt: tz('starts_at'),
    endsAt: tz('ends_at'),
    createdBy: uuid('created_by'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('campaigns_tenant_status_placement_idx').on(t.tenantId, t.status, t.placement),
    check(
      'campaigns_placement_check',
      sql`${t.placement} in ('home_hero','pdp_sidebar','cart_upsell','category_banner')`,
    ),
    check('campaigns_status_check', sql`${t.status} in ('draft','active','paused','ended')`),
    check('campaigns_goal_check', sql`${t.goal} in ('click','conversion')`),
  ],
);

export const creatives = pgTable(
  'creatives',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    headline: text('headline').notNull(),
    body: text('body').notNull(),
    cta: text('cta').notNull(),
    tone: text('tone'),
    targetSegment: text('target_segment'),
    status: text('status').notNull(),
    source: text('source').notNull(),
    generation: jsonb('generation').$type<Record<string, unknown>>(),
    guardrailFlags: text('guardrail_flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: tz('reviewed_at'),
    reviewComment: text('review_comment'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('creatives_campaign_status_idx').on(t.campaignId, t.status),
    check('creatives_headline_check', sql`char_length(${t.headline}) <= 60`),
    check('creatives_body_check', sql`char_length(${t.body}) <= 160`),
    check('creatives_cta_check', sql`char_length(${t.cta}) <= 24`),
    check('creatives_status_check', sql`${t.status} in ('draft','approved','rejected','active','paused')`),
    check('creatives_source_check', sql`${t.source} in ('llm','human')`),
  ],
);

export const banditSnapshots = pgTable(
  'bandit_snapshots',
  {
    campaignId: uuid('campaign_id').notNull(),
    segmentKey: text('segment_key').notNull(),
    creativeId: uuid('creative_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    alpha: doublePrecision('alpha').notNull(),
    beta: doublePrecision('beta').notNull(),
    impressions: bigint('impressions', { mode: 'number' }).notNull(),
    successes: bigint('successes', { mode: 'number' }).notNull(),
    snapshotAt: tz('snapshot_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.segmentKey, t.creativeId, t.snapshotAt] })],
);

export const customerProfiles = pgTable(
  'customer_profiles',
  {
    tenantId: uuid('tenant_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    customerId: uuid('customer_id'),
    features: jsonb('features').$type<Record<string, unknown>>().notNull(),
    segments: text('segments')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.profileId] })],
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    url: text('url').notNull(),
    events: text('events').array().notNull(),
    secret: text('secret').notNull(),
    secretPrefix: text('secret_prefix').notNull(),
    status: text('status').notNull().default('active'),
    description: text('description'),
    createdAt: tz('created_at').notNull().defaultNow(),
    disabledAt: tz('disabled_at'),
  },
  (t) => [
    index('webhook_endpoints_tenant_idx').on(t.tenantId, t.status),
    check('webhook_endpoints_status_check', sql`${t.status} in ('active','disabled')`),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at'),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    durationMs: integer('duration_ms'),
    createdAt: tz('created_at').notNull().defaultNow(),
    deliveredAt: tz('delivered_at'),
  },
  (t) => [
    unique('webhook_deliveries_endpoint_event_unique').on(t.endpointId, t.eventId),
    index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
    check('webhook_deliveries_status_check', sql`${t.status} in ('pending','succeeded','failed','dead')`),
  ],
);

export const fakePaymentWebhooks = pgTable(
  'fake_payment_webhooks',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    intentId: text('intent_id').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    dueAt: tz('due_at').notNull(),
    lastError: text('last_error'),
    createdAt: tz('created_at').notNull().defaultNow(),
    deliveredAt: tz('delivered_at'),
  },
  (t) => [
    index('fake_payment_webhooks_due_idx')
      .on(t.dueAt)
      .where(sql`status = 'pending'`),
    index('fake_payment_webhooks_intent_idx').on(t.intentId),
    check('fake_payment_webhooks_status_check', sql`${t.status} in ('pending','delivered','failed')`),
  ],
);

export const TENANT_TABLES = [
  'memberships',
  'invitations',
  'api_keys',
  'audit_log',
  'tenant_counters',
  'categories',
  'products',
  'product_images',
  'product_variants',
  'inventory_items',
  'inventory_reservations',
  'inventory_movements',
  'customers',
  'carts',
  'cart_items',
  'discounts',
  'orders',
  'order_items',
  'order_status_history',
  'payments',
  'jobs',
  'segments',
  'campaigns',
  'creatives',
  'bandit_snapshots',
  'customer_profiles',
  'webhook_endpoints',
  'webhook_deliveries',
  'fake_payment_webhooks',
] as const;

export const GLOBAL_TABLES = [
  'tenants',
  'users',
  'refresh_tokens',
  'payment_webhook_events',
  'outbox',
  'processed_messages',
] as const;
