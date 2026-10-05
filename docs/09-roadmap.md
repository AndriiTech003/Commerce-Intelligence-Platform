# 09 · Roadmap

Оценка: ~10–12 часов в неделю. Каждый milestone заканчивается **рабочим состоянием `main`** и коротким постом или заметкой в `CHANGELOG.md`.

Правило: milestone считается закрытым, только когда выполнены его тесты и пункты «Готово, когда».

---

## M0 — Фундамент (1 неделя)

- [ ] Монорепо: pnpm workspaces, Turborepo, `packages/config` (tsconfig strict, eslint flat config, prettier, vitest preset)
- [ ] `docker-compose.yml`: Postgres 17 (+pgvector, ltree, citext, pg_trgm), Redis 7, RabbitMQ 4 (management + prometheus), ClickHouse, MinIO, Mailpit
- [ ] `apps/api` каркас NestJS: конфиг с zod-валидацией, pino, health endpoints, exception filter (Problem Details), request id
- [ ] `packages/observability`: OTel SDK bootstrap, prom-client, `/metrics`
- [ ] `packages/contracts`: структура, первые схемы
- [ ] Drizzle + миграции + RLS-хелпер `withTenant()` + AsyncLocalStorage-контекст
- [ ] GitHub Actions: lint, typecheck, unit, integration (Testcontainers smoke)
- [ ] ADR-001 (модульный монолит), ADR-002 (RLS), ADR-003 (Drizzle)

**Готово, когда:** `docker compose up` + `pnpm dev` поднимает API с `/health/ready` = ok, CI зелёный, есть integration-тест RLS на тестовой таблице.

## M1 — Tenancy, Identity, Catalog (2 недели)

- [ ] Signup мерчанта, login, refresh rotation + reuse detection, logout
- [ ] Memberships, роли → permissions, guard `@RequirePermission()`
- [ ] Приглашения (Mailpit), API-ключи (hash, prefix, scopes)
- [ ] Audit log (interceptor для мутаций + diff)
- [ ] Categories (ltree), products, variants, inventory items
- [ ] Full-text + trigram поиск
- [ ] Presigned upload в MinIO
- [ ] OpenAPI + генерация клиента в `packages/api-client`
- [ ] Seed: 2 тенанта, каталоги
- [ ] `apps/admin`: login, layout, переключатель тенанта, список и форма товара, команда и роли, API-ключи
- [ ] Тесты: tenant isolation по всем таблицам, auth-сценарии, permissions

**Готово, когда:** можно зарегистрировать магазин, пригласить сотрудника с ролью catalog_manager, он создаёт товар с фото, а сотрудник другого магазина его не видит (тест + E2E).

## M2 — Storefront, Cart, Checkout, Orders (3 недели)

- [ ] `apps/storefront`: определение магазина по хосту, главная, категория, PDP, поиск
- [ ] Корзина (anonymous + customer, merge при логине)
- [ ] Discounts
- [ ] Checkout: резервирование, Idempotency-Key, номер заказа, FakePaymentProvider + вебхук
- [ ] Статусная машина заказа (общая в `contracts`), история, refund
- [ ] Истечение резервов (domain-worker, distributed lock)
- [ ] **Outbox** + relay (`FOR UPDATE SKIP LOCKED` + LISTEN/NOTIFY)
- [ ] `packages/messaging`: publisher confirms, consumer с retry/DLQ, дедуп, OTel propagation
- [ ] Email-уведомления (order paid) через очередь
- [ ] Admin: заказы (список, карточка, переходы, refund), остатки, скидки
- [ ] Тесты: overselling, idempotency, outbox durability, webhook idempotency, retry/DLQ
- [ ] E2E: полный checkout
- [ ] ADR: outbox, idempotency, retry-очереди с TTL, порядок блокировок

**Готово, когда:** гость покупает товар, в Mailpit приходит письмо, заказ в админке переходит в `fulfilled`; все инвариантные тесты зелёные. **С этого момента проект можно показывать.**

## M3 — Event pipeline + realtime analytics (2–3 недели)

- [ ] `packages/tracker-sdk` + интеграция в витрину (+ consent-баннер)
- [ ] `apps/collector` (Fastify): валидация, ключи, rate limit, обогащение, confirms, буфер при недоступности брокера
- [ ] Топология RabbitMQ как код (`definitions.json`)
- [ ] `apps/stream-worker`: батч в ClickHouse, дедуп, realtime-счётчики, pub/sub тики
- [ ] ClickHouse-миграции: events, MV, decisions
- [ ] `apps/realtime-gateway`: WS с auth по ticket, подписка на канал тенанта, heartbeat
- [ ] Admin: Live dashboard, Analytics (overview, timeseries, funnel, top products, cohorts)
- [ ] Platform: DLQ-просмотр и replay
- [ ] Grafana: дашборд Event pipeline
- [ ] Тесты: dedup, contract-тесты событий, E2E live dashboard
- [ ] ADR: ClickHouse, двухуровневый дедуп, ручные батчи vs async_insert

**Готово, когда:** клики на витрине появляются на live-дашборде меньше чем через 2 секунды, в Grafana видна e2e-свежесть, в Tempo есть трейс от браузера до ClickHouse.

## M4 — Profiles, segments, recommendations (2 недели)

- [ ] Профиль в Redis (Lua, затухание), снапшоты в Postgres, склейка identity
- [ ] Сегменты: движок правил, системные сегменты, CRUD, превью
- [ ] Embeddings товаров (domain-worker, провайдер через конфиг, локальная модель для dev)
- [ ] Co-occurrence, popular (Redis)
- [ ] Кандидаты + ранжирование + MMR + contributions
- [ ] Storefront: «Для вас», «Похожие», «С этим покупают»
- [ ] Admin: профиль покупателя, конструктор сегментов
- [ ] Unit: затухание, правила, ранжирование; integration: pgvector-запросы с фильтром тенанта

**Готово, когда:** после 5 просмотров беговых кроссовок «Для вас» заметно меняется, а в админке у покупателя видно аффинити и сегменты.

## M5 — Campaigns, LLM creatives, Thompson sampling (2–3 недели)

- [ ] Кампании (CRUD, селектор товаров, сегменты, placement, goal)
- [ ] `LlmClient` (реальный + Fake), промпты с версиями, structured output, guardrails, кэш, лимиты, учёт стоимости
- [ ] Review queue + approve (permission)
- [ ] Beta-сэмплер (свой, seeded), bandit state в Redis (Lua), снапшоты
- [ ] Decision API (p95 < 50 мс), explanation, запись в `decisions`
- [ ] Атрибуция last-click 24h → конверсии
- [ ] Holdout 10%
- [ ] Storefront: блоки кампаний, impression по IntersectionObserver, «Why this?»
- [ ] Admin: мастер кампании, генерация, превью, экран эксперимента (arms, интервалы, P(best), доля трафика, плотности Beta)
- [ ] `pnpm eval:creatives`
- [ ] ADR: LLM вне hot path, Thompson vs A/B, основной сегмент, шаблонные объяснения

**Готово, когда:** маркетолог генерирует 3 креатива, одобряет их, они крутятся на витрине, а экран эксперимента обновляется.

## M6 — Simulator + нагрузка + chaos (2 недели)

- [ ] `apps/simulator`: персоны (yaml), модель сессии, режимы live / backfill / shift / load
- [ ] Управление из админки + экран «Ground truth vs learned» + regret vs uniform
- [ ] k6-сценарии, прогон на демо-сервере, поиск и исправление минимум одного узкого места (flame graph до и после)
- [ ] Chaos-скрипты, прогон, таблица результатов
- [ ] Grafana: все 4 дашборда, алерты
- [ ] README: Performance + Resilience разделы

**Готово, когда:** за 10 минут симуляции bandit находит правильный тон для 3 из 4 основных персон, а в README есть честные цифры нагрузки и результаты chaos-тестов.

## M7 — Полировка и публикация (1–2 недели)

- [ ] Деплой демо (VPS + Caddy + GHCR + автодеплой + ночной сброс)
- [ ] AI Insights (агрегаты → LLM → наблюдения со ссылками на цифры) — если есть время
- [ ] Исходящие вебхуки мерчанта — если есть время
- [ ] Публичный README на английском (по шаблону), диаграммы, скриншоты, GIF
- [ ] Видео 2–3 минуты по сценарию из `10-demo-and-readme.md`
- [ ] Все ADR оформлены, раздел Known limitations
- [ ] Прогнать чек-лист Definition of Done из корневого README
- [ ] (Опционально) Terraform для AWS
- [ ] (Опционально) Интеграция с проектом 02: фича «AI creatives» за feature flag

---

## Итого

| Milestone | Недели | Накопительно |
|---|---|---|
| M0 | 1 | 1 |
| M1 | 2 | 3 |
| M2 | 3 | 6 |
| M3 | 2.5 | 8.5 |
| M4 | 2 | 10.5 |
| M5 | 2.5 | 13 |
| M6 | 2 | 15 |
| M7 | 1.5 | 16.5 |

Если времени меньше, резать в таком порядке: AI Insights → вебхуки мерчанта → CSV-импорт → cohorts → Terraform → второй placement. **Не резать:** outbox, инвариантные тесты, симулятор, экран эксперимента, нагрузочный отчёт.
