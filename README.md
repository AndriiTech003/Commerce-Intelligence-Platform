# 01 · Commerce Intelligence Platform

> Multi-tenant e-commerce платформа + событийный конвейер + AI-персонализация — **одна экосистема в монорепо**.

## Идея в одном абзаце

Мерчант регистрирует магазин, заводит каталог и получает витрину. Каждое действие покупателя (просмотр, корзина, покупка, клик по рекламе) превращается в событие, которое надёжно проходит через RabbitMQ, попадает в ClickHouse и в realtime-дашборд мерчанта. Эти же события строят профиль покупателя. Движок персонализации подбирает товары и рекламный креатив (сгенерированный LLM и одобренный человеком), а **Thompson sampling** сам учится, какой вариант работает для какого сегмента. Симулятор трафика генерирует реалистичное поведение, поэтому «обучение» видно на демо.

## Почему это сильный проект для full-stack 4+

| Навык | Где проявляется |
|---|---|
| Frontend | Витрина (Next.js, SSR/ISR), админка мерчанта, realtime-графики, редактор кампаний |
| Backend | NestJS-модули, транзакции, идемпотентность, резервирование склада без overselling |
| Multi-tenancy | Shared schema + `tenant_id` + **PostgreSQL Row-Level Security** |
| Надёжность событий | Transactional outbox, publisher confirms, retry с backoff, DLQ, дедупликация |
| Данные | ClickHouse (MergeTree, materialized views, воронки), Redis (HLL, счётчики) |
| AI | Профили, кандидаты через pgvector, LLM-креативы с guardrails, bandits, объяснимость |
| Инженерная зрелость | Testcontainers, k6, chaos-сценарии, OpenTelemetry end-to-end, ADR |

## Документация

| Файл | Содержание |
|---|---|
| [docs/01-product-scope.md](docs/01-product-scope.md) | Роли, фичи, что входит в MVP и что **не** входит |
| [docs/02-architecture.md](docs/02-architecture.md) | Сервисы, диаграммы, потоки данных, выбор технологий |
| [docs/03-data-model.md](docs/03-data-model.md) | PostgreSQL DDL, RLS, ClickHouse-таблицы, Redis-ключи |
| [docs/04-events-and-messaging.md](docs/04-events-and-messaging.md) | Контракты событий, топология RabbitMQ, retry/DLQ, outbox |
| [docs/05-api.md](docs/05-api.md) | Endpoints, аутентификация, ошибки, пагинация, идемпотентность |
| [docs/06-personalization-engine.md](docs/06-personalization-engine.md) | Профили, сегменты, рекомендации, LLM-креативы, Thompson sampling, симулятор |
| [docs/07-frontend.md](docs/07-frontend.md) | Экраны витрины и админки, состояние, realtime, UX-детали |
| [docs/08-quality-testing-observability.md](docs/08-quality-testing-observability.md) | Тесты, нагрузка, chaos, метрики, трейсинг, CI/CD, деплой |
| [docs/09-roadmap.md](docs/09-roadmap.md) | Milestones M0–M7 с задачами и критериями готовности |
| [docs/10-demo-and-readme.md](docs/10-demo-and-readme.md) | Сценарий 3-минутного демо, структура публичного README |
| [docs/adr/README.md](docs/adr/README.md) | Список ADR с решениями и альтернативами |

## Структура монорепо (итоговая)

```text
commerce-intelligence-platform/
├── apps/
│   ├── storefront/          # Next.js — витрина магазина (покупатель)
│   ├── admin/               # Next.js — дашборд мерчанта
│   ├── api/                 # NestJS — core commerce API (+ personalization-модуль)
│   ├── collector/           # Fastify — приём событий трекинга (высокая нагрузка)
│   ├── stream-worker/       # Node — события → ClickHouse, Redis-счётчики, профили
│   ├── domain-worker/       # Node — outbox relay, уведомления, истечение резервов, вебхуки
│   ├── realtime-gateway/    # Node + ws — пуш метрик в админку
│   └── simulator/           # Node — генератор реалистичного трафика (персоны)
├── packages/
│   ├── contracts/           # zod-схемы событий и DTO, общие типы
│   ├── tracker-sdk/         # браузерный SDK трекинга (batching, sendBeacon, retry)
│   ├── messaging/           # обёртка над amqplib: confirms, retry, DLQ, tracing
│   ├── observability/       # OTel + pino + prom-client, общий бутстрап
│   ├── ui/                  # общие React-компоненты (shadcn/ui + свои)
│   └── config/              # tsconfig, eslint, prettier, vitest presets
├── infra/
│   ├── docker/              # Dockerfile'ы (multi-stage), compose-файлы
│   ├── clickhouse/          # миграции ClickHouse
│   ├── rabbitmq/            # definitions.json (топология как код)
│   ├── grafana/             # дашборды как JSON
│   ├── k6/                  # сценарии нагрузки
│   ├── chaos/               # скрипты отказов
│   └── terraform/           # (опционально) AWS: ECS/RDS/ElastiCache/AmazonMQ
├── docs/                    # эта документация + ADR
├── .github/workflows/
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## Главные инварианты (то, что проект гарантирует и доказывает тестами)

1. **Данные одного тенанта недоступны другому** — даже при баге в коде приложения (RLS).
2. **Нет overselling** — 100 параллельных checkout на остаток 10 → ровно 10 заказов.
3. **Повторный checkout с тем же `Idempotency-Key` не создаёт второй заказ.**
4. **Ни одно доменное событие не теряется**, если RabbitMQ недоступен в момент коммита (outbox).
5. **Событие трекинга не учитывается дважды** в аналитике (event_id + дедупликация + ReplacingMergeTree).
6. **Ни один AI-креатив не показывается без одобрения человека.**
7. **Каждое решение персонализации объяснимо** — сохраняются признаки и их вклад.
