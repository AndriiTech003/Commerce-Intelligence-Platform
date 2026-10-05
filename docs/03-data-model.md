# 03 · Модель данных

## PostgreSQL

Общие правила:
- PK — `uuid` (UUIDv7, генерируется в приложении: сортируемый по времени, хорош для индексов).
- Деньги — `bigint` в минорных единицах (`*_cents`) + `currency char(3)`. Никаких `float`.
- Время — `timestamptz`, всегда UTC.
- У каждой тенантной таблицы — `tenant_id uuid not null` и RLS-политика.
- Миграции — Drizzle Kit, в CI проверка, что миграции применяются на пустую БД и схема совпадает с кодом.

### Tenancy & identity

```sql
create table tenants (
  id          uuid primary key,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,32}$'),
  name        text not null,
  status      text not null default 'active' check (status in ('active','suspended')),
  settings    jsonb not null default '{}',     -- валюта, low_stock_threshold, брендинг
  created_at  timestamptz not null default now()
);

create table users (                            -- сотрудники (глобальные, без tenant_id)
  id             uuid primary key,
  email          citext not null unique,
  password_hash  text not null,                 -- argon2id
  name           text not null,
  created_at     timestamptz not null default now()
);

create table memberships (
  tenant_id  uuid not null references tenants(id),
  user_id    uuid not null references users(id),
  role       text not null check (role in ('owner','admin','catalog_manager','marketer','support')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table invitations (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  email       citext not null,
  role        text not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz
);

create table refresh_tokens (
  id          uuid primary key,
  subject_id  uuid not null,                    -- user_id или customer_id
  subject_type text not null check (subject_type in ('user','customer')),
  family_id   uuid not null,                    -- для reuse detection
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  replaced_by uuid
);

create table api_keys (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  kind         text not null check (kind in ('publishable','secret')),
  prefix       text not null,                   -- pk_live_ab12 — показывается в UI
  key_hash     text not null unique,            -- sha256
  scopes       text[] not null default '{}',
  created_by   uuid references users(id),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table audit_log (
  id          uuid primary key,
  tenant_id   uuid not null,
  actor_type  text not null,                    -- user | api_key | system
  actor_id    uuid,
  action      text not null,                    -- product.updated
  entity_type text not null,
  entity_id   uuid,
  diff        jsonb,                            -- {field: [old, new]}
  ip          inet,
  created_at  timestamptz not null default now()
);
create index on audit_log (tenant_id, created_at desc);
```

### Catalog & inventory

```sql
create table categories (
  id         uuid primary key,
  tenant_id  uuid not null,
  parent_id  uuid references categories(id),
  name       text not null,
  slug       text not null,
  path       ltree not null,                    -- running.shoes.trail — быстрые выборки поддерева
  unique (tenant_id, slug)
);

create table products (
  id           uuid primary key,
  tenant_id    uuid not null,
  category_id  uuid references categories(id),
  title        text not null,
  slug         text not null,
  description  text not null default '',
  brand        text,
  status       text not null default 'draft' check (status in ('draft','active','archived')),
  attributes   jsonb not null default '{}',     -- {"activity":"running","terrain":"road"}
  tags         text[] not null default '{}',
  search_tsv   tsvector generated always as (
                 setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(brand,'')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(description,'')), 'C')) stored,
  embedding    vector(1024),                    -- размерность зависит от модели
  embedding_version text,                       -- чтобы пересчитать при смене модели
  price_min_cents bigint,                       -- денормализация для фильтров/ранжирования
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index on products using gin (search_tsv);
create index on products using gin (title gin_trgm_ops);
create index on products using hnsw (embedding vector_cosine_ops);
create index on products (tenant_id, status, category_id);

create table product_images (
  id uuid primary key, tenant_id uuid not null, product_id uuid not null references products(id) on delete cascade,
  storage_key text not null, position int not null, alt text
);

create table product_variants (
  id               uuid primary key,
  tenant_id        uuid not null,
  product_id       uuid not null references products(id) on delete cascade,
  sku              text not null,
  title            text not null,               -- "42 / Black"
  price_cents      bigint not null check (price_cents >= 0),
  compare_at_cents bigint,
  currency         char(3) not null,
  attributes       jsonb not null default '{}',
  unique (tenant_id, sku)
);

create table inventory_items (
  variant_id  uuid primary key references product_variants(id) on delete cascade,
  tenant_id   uuid not null,
  on_hand     int not null check (on_hand >= 0),
  reserved    int not null default 0 check (reserved >= 0),
  check (reserved <= on_hand)                   -- инвариант на уровне БД
);

create table inventory_reservations (
  id          uuid primary key,
  tenant_id   uuid not null,
  order_id    uuid not null,
  variant_id  uuid not null,
  quantity    int not null check (quantity > 0),
  status      text not null check (status in ('active','committed','released')),
  expires_at  timestamptz not null
);
create index on inventory_reservations (expires_at) where status = 'active';

create table inventory_movements (
  id uuid primary key, tenant_id uuid not null, variant_id uuid not null,
  delta int not null, reason text not null,     -- sale | refund | manual_adjustment | import
  reference_id uuid, actor_id uuid, created_at timestamptz not null default now()
);
```

Резервирование (атомарно, без SELECT … FOR UPDATE на чтение):

```sql
update inventory_items
set reserved = reserved + $qty
where variant_id = $variant and on_hand - reserved >= $qty
returning variant_id;
-- 0 строк → недостаточно товара
```

### Customers, carts, discounts, orders, payments

```sql
create table customers (
  id            uuid primary key,
  tenant_id     uuid not null,
  email         citext not null,
  name          text,
  password_hash text,                           -- null = гостевой checkout
  anonymous_ids uuid[] not null default '{}',   -- связанные анонимные id (identity stitching)
  created_at    timestamptz not null default now(),
  unique (tenant_id, email)
);

create table carts (
  id           uuid primary key,
  tenant_id    uuid not null,
  customer_id  uuid references customers(id),
  anonymous_id uuid,
  status       text not null default 'active' check (status in ('active','converted','merged','abandoned')),
  discount_code text,
  updated_at   timestamptz not null default now()
);
create unique index on carts (tenant_id, customer_id) where status = 'active' and customer_id is not null;
create unique index on carts (tenant_id, anonymous_id) where status = 'active' and anonymous_id is not null;

create table cart_items (
  cart_id    uuid not null references carts(id) on delete cascade,
  variant_id uuid not null,
  tenant_id  uuid not null,
  quantity   int not null check (quantity between 1 and 99),
  added_at   timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

create table discounts (
  id                 uuid primary key,
  tenant_id          uuid not null,
  code               citext not null,
  type               text not null check (type in ('percent','fixed')),
  value              bigint not null,           -- percent: 1..100, fixed: cents
  min_subtotal_cents bigint not null default 0,
  starts_at          timestamptz,
  ends_at            timestamptz,
  usage_limit        int,
  per_customer_limit int,
  used_count         int not null default 0,
  active             boolean not null default true,
  unique (tenant_id, code)
);

create table orders (
  id               uuid primary key,
  tenant_id        uuid not null,
  number           bigint not null,             -- человекочитаемый, последовательный в рамках тенанта
  customer_id      uuid references customers(id),
  email            citext not null,
  status           text not null,
  currency         char(3) not null,
  subtotal_cents   bigint not null,
  discount_cents   bigint not null default 0,
  shipping_cents   bigint not null default 0,
  total_cents      bigint not null,
  discount_code    text,
  shipping_address jsonb not null,
  idempotency_key  text not null,
  attribution      jsonb,                       -- {decisionId, campaignId, creativeId} last-click
  placed_at        timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, idempotency_key)
);

create table order_items (
  id uuid primary key, tenant_id uuid not null, order_id uuid not null references orders(id),
  variant_id uuid not null, product_id uuid not null,
  title_snapshot text not null, sku_snapshot text not null,   -- снапшот на момент покупки
  unit_price_cents bigint not null, quantity int not null
);

create table order_status_history (
  id uuid primary key, tenant_id uuid not null, order_id uuid not null,
  from_status text, to_status text not null, reason text, actor_id uuid,
  created_at timestamptz not null default now()
);

create table payments (
  id                uuid primary key,
  tenant_id         uuid not null,
  order_id          uuid not null references orders(id),
  provider          text not null,              -- fake | stripe
  provider_ref      text not null,
  status            text not null,              -- requires_action | succeeded | failed | refunded
  amount_cents      bigint not null,
  created_at        timestamptz not null default now(),
  unique (provider, provider_ref)
);

create table payment_webhook_events (           -- идемпотентность вебхуков
  provider text not null, provider_event_id text not null,
  received_at timestamptz not null default now(), processed_at timestamptz,
  primary key (provider, provider_event_id)
);
```

Номер заказа: таблица `tenant_counters(tenant_id, name, value)` + `update … set value = value + 1 returning value` в той же транзакции.

### Outbox / inbox

```sql
create table outbox (
  id             uuid primary key,              -- = event_id
  tenant_id      uuid not null,
  aggregate_type text not null,                 -- order
  aggregate_id   uuid not null,
  event_type     text not null,                 -- order.placed
  payload        jsonb not null,
  headers        jsonb not null default '{}',   -- traceparent для OTel
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  attempts       int not null default 0,
  last_error     text
);
create index on outbox (created_at) where published_at is null;

create table processed_messages (               -- inbox для at-least-once → effectively-once
  consumer   text not null,
  message_id uuid not null,
  processed_at timestamptz not null default now(),
  primary key (consumer, message_id)
);
```

Outbox **не** под RLS (его читает системный воркер). Очистка опубликованных > 7 дней — cron в domain-worker.

### Personalization & campaigns

```sql
create table segments (
  id          uuid primary key,
  tenant_id   uuid not null,
  key         text not null,                    -- high_intent_runner
  name        text not null,
  rules       jsonb not null,                   -- см. 06-personalization-engine.md
  priority    int not null default 100,
  is_system   boolean not null default false,   -- new_visitor, returning, churn_risk...
  unique (tenant_id, key)
);

create table campaigns (
  id               uuid primary key,
  tenant_id        uuid not null,
  name             text not null,
  placement        text not null check (placement in ('home_hero','pdp_sidebar','cart_upsell','category_banner')),
  status           text not null check (status in ('draft','active','paused','ended')),
  target_segments  text[] not null,             -- keys; пусто = все
  product_selector jsonb not null,              -- {"categoryPath":"running.*","priceMax":20000}
  goal             text not null check (goal in ('click','conversion')),
  starts_at timestamptz, ends_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);

create table creatives (
  id              uuid primary key,
  tenant_id       uuid not null,
  campaign_id     uuid not null references campaigns(id),
  headline        text not null check (char_length(headline) <= 60),
  body            text not null check (char_length(body) <= 160),
  cta             text not null check (char_length(cta) <= 24),
  tone            text,                         -- performance | lifestyle | value | premium
  target_segment  text,                         -- для какого сегмента генерировался (подсказка)
  status          text not null check (status in ('draft','approved','rejected','active','paused')),
  source          text not null check (source in ('llm','human')),
  generation      jsonb,                        -- {model, promptVersion, inputHash, latencyMs, tokens}
  guardrail_flags text[] not null default '{}',
  reviewed_by     uuid, reviewed_at timestamptz,
  created_at      timestamptz not null default now()
);

create table bandit_snapshots (                 -- периодический снапшот состояния из Redis
  campaign_id uuid not null, segment_key text not null, creative_id uuid not null,
  tenant_id uuid not null,
  alpha double precision not null, beta double precision not null,
  impressions bigint not null, successes bigint not null,
  snapshot_at timestamptz not null default now(),
  primary key (campaign_id, segment_key, creative_id, snapshot_at)
);

create table customer_profiles (                -- durable-копия профиля (основной — в Redis)
  tenant_id   uuid not null,
  profile_id  uuid not null,                    -- customer_id или anonymous_id
  customer_id uuid,
  features    jsonb not null,
  segments    text[] not null default '{}',
  updated_at  timestamptz not null,
  primary key (tenant_id, profile_id)
);
```

### Row-Level Security

```sql
alter table products enable row level security;
alter table products force row level security;   -- даже для владельца таблицы

create policy tenant_isolation on products
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
-- генерируется миграцией для всех тенантных таблиц
```

- Приложение подключается ролью `app_user` (без `BYPASSRLS`), воркеры для системных задач — ролью `app_system`.
- Каждый запрос API: `BEGIN; SET LOCAL app.tenant_id = '…'; …; COMMIT` — реализуется через `AsyncLocalStorage` + обёртку над Drizzle (`withTenant(tx => …)`).
- Если `app.tenant_id` не установлен → `current_setting` бросает ошибку → запрос падает, **а не** возвращает чужие данные.
- **Тест**: integration-тест, который намеренно делает `select * from products` без `where tenant_id` в контексте тенанта A и проверяет, что данных B нет.

---

## ClickHouse

```sql
create table events (
  event_id       UUID,
  tenant_id      UUID,
  event_type     LowCardinality(String),
  occurred_at    DateTime64(3, 'UTC'),
  received_at    DateTime64(3, 'UTC'),
  profile_id     UUID,                         -- customer_id если есть, иначе anonymous_id
  anonymous_id   UUID,
  customer_id    Nullable(UUID),
  session_id     UUID,
  product_id     Nullable(UUID),
  variant_id     Nullable(UUID),
  category_path  LowCardinality(String),
  price_cents    Nullable(Int64),
  quantity       Nullable(Int32),
  order_id       Nullable(UUID),
  revenue_cents  Nullable(Int64),
  decision_id    Nullable(UUID),
  campaign_id    Nullable(UUID),
  creative_id    Nullable(UUID),
  segment_key    LowCardinality(String),
  country        LowCardinality(String),
  device         LowCardinality(String),
  properties     String                         -- JSON, редкие поля
)
engine = ReplacingMergeTree(received_at)
partition by toYYYYMM(occurred_at)
order by (tenant_id, event_type, toDate(occurred_at), event_id)
ttl toDateTime(occurred_at) + interval 13 month;
```

> ReplacingMergeTree схлопывает дубли **в фоне**. Для точных цифр в отчётах — либо `FINAL` на небольших диапазонах, либо дедуп на входе (Redis `SET NX event_id`). Делаем оба уровня, в ADR объяснить.

Materialized views:

```sql
-- поминутные агрегаты для графиков
create table events_per_minute (
  tenant_id UUID, event_type LowCardinality(String), minute DateTime,
  events AggregateFunction(count), uniq_profiles AggregateFunction(uniq, UUID),
  revenue AggregateFunction(sum, Int64)
) engine = AggregatingMergeTree order by (tenant_id, event_type, minute);

create materialized view mv_events_per_minute to events_per_minute as
select tenant_id, event_type, toStartOfMinute(occurred_at) as minute,
       countState() as events, uniqState(profile_id) as uniq_profiles,
       sumState(coalesce(revenue_cents, 0)) as revenue
from events group by tenant_id, event_type, minute;

-- дневная статистика по товарам (просмотры, добавления, покупки)
create table product_stats_daily (...) engine = SummingMergeTree ...;

-- статистика показов/кликов/конверсий кампаний по креативу и сегменту
create table campaign_stats_hourly (...) engine = SummingMergeTree ...;

-- лог решений персонализации
create table decisions (
  decision_id UUID, tenant_id UUID, placement LowCardinality(String),
  profile_id UUID, segment_key LowCardinality(String),
  campaign_id UUID, creative_id UUID, product_ids Array(UUID),
  sampled_scores Map(String, Float64),         -- creative_id → sample из Beta
  explanation String,                          -- JSON
  decided_at DateTime64(3, 'UTC')
) engine = MergeTree order by (tenant_id, decided_at) ttl toDateTime(decided_at) + interval 90 day;
```

Воронка:

```sql
select level, count() as users from (
  select profile_id,
         windowFunnel(3600)(occurred_at,
           event_type = 'product_viewed', event_type = 'cart_item_added',
           event_type = 'checkout_started', event_type = 'order_placed') as level
  from events
  where tenant_id = {tenant:UUID} and occurred_at between {from:DateTime} and {to:DateTime}
  group by profile_id
) group by level order by level;
```

Миграции ClickHouse — отдельная папка `infra/clickhouse/migrations`, простой раннер (скрипт на Node с таблицей `schema_migrations`).

---

## Redis — ключи

| Ключ | Тип | TTL | Назначение |
|---|---|---|---|
| `idem:{tenant}:{key}` | string (JSON: status, response) | 24h | Idempotency checkout |
| `dedup:evt:{event_id}` | string | 48h | Дедуп событий в stream-worker |
| `rl:{apiKeyId}:{window}` | sorted set / counter | окно | Rate limit collector |
| `rl:login:{ip}` | counter | 15m | Brute-force защита логина |
| `rt:{tenant}:ev:{epochSec}` | hash (event_type → count) | 10m | Events/sec для live-графика |
| `rt:{tenant}:active:{epochMin}` | HyperLogLog | 10m | Активные посетители (PFCOUNT по 5 последним минутам) |
| `rt:{tenant}:revenue:{yyyymmdd}` | counter | 48h | Выручка сегодня |
| `rt:{tenant}:feed` | list (LTRIM 50) | — | Лента последних событий |
| `profile:{tenant}:{profileId}` | hash | 90d | Профиль персонализации |
| `bandit:{campaignId}:{segment}` | hash (`{creativeId}:a`, `{creativeId}:b`) | — | Параметры Beta-распределений |
| `reco:cooc:{tenant}:{productId}` | sorted set | 7d | «С этим смотрят/покупают» (co-occurrence) |
| `reco:popular:{tenant}:{category}` | sorted set | 1h | Популярное (fallback) |
| `apikey:{hash}` | hash | 5m | Кэш проверки API-ключей |
| `lock:{name}` | string (token) | короткий | Распределённые блокировки (истечение резервов, snapshot bandit) |
| `sim:state` | hash | — | Состояние симулятора |

Pub/Sub каналы: `rt:{tenant}:tick` (раз в секунду агрегат для gateway), `rt:{tenant}:events` (лента).

Правило: **все ключи с TTL, кроме явно перечисленных**. Проверка в тестах через `OBJECT` / `TTL` на ключах после сценария.
