# 08 · Качество: тесты, нагрузка, отказы, наблюдаемость, CI/CD, деплой

## Пирамида тестов

| Уровень | Инструмент | Что покрывает | Где запускается |
|---|---|---|---|
| Unit | Vitest | Домен: статусная машина заказа, расчёт корзины и скидок, сегментные правила, профиль и затухание, Beta-сэмплер, ранжирование, guardrails, tracker-sdk | каждый PR, < 30 сек |
| Integration | Vitest + **Testcontainers** (Postgres, Redis, RabbitMQ, ClickHouse) | Репозитории, RLS, outbox relay, consumers с ретраями и DLQ, ClickHouse-запросы, идемпотентность | каждый PR |
| Contract | Vitest | Фикстуры событий всех версий через каждый consumer; OpenAPI-схема vs сгенерированный клиент (diff = ошибка) | каждый PR |
| E2E | Playwright | Ключевые пользовательские сценарии через UI на поднятом compose | каждый PR (smoke), nightly (полный) |
| Load | k6 | Collector, checkout, decision API | вручную + nightly (короткий) |
| Chaos | bash + docker | Отказы брокера и воркеров | вручную, результаты в README |

### Обязательные «доказательные» тесты (инварианты из README)

1. **Tenant isolation**
   - Для каждой тенантной таблицы: создать данные в A и B → в контексте A выполнить запрос без фильтра → данных B нет.
   - Попытка вставить строку с чужим `tenant_id` → ошибка политики.
   - API-тест: сотрудник A с `X-Tenant-Id: B` → 403.
2. **No overselling**: остаток 10, `Promise.all` из 100 checkout по 1 шт от разных покупателей → ровно 10 заказов, `reserved = 10`, остальные `409`. Отдельный кейс: 2 товара в разном порядке в корзинах, чтобы проверить отсутствие deadlock.
3. **Idempotency**: 5 параллельных checkout с одним ключом → 1 заказ, 4 ответа либо replay, либо `409 IN_PROGRESS`. Тот же ключ с другим телом → `422`.
4. **Outbox durability**: остановить RabbitMQ-контейнер → сделать 20 заказов (все успешны) → запустить брокер → через ≤ N сек все 20 `order.placed` в очереди, дублей нет.
5. **Consumer retry/DLQ**: handler падает 2 раза, потом успех → обработано 1 раз, `x-retry-count = 2`. Poison-сообщение → сразу в DLQ. Replay из DLQ → обработано.
6. **Analytics dedup**: одно событие отправить 3 раза → в ClickHouse после `OPTIMIZE … FINAL` одна строка, счётчик в Redis увеличен 1 раз.
7. **Human approval**: креатив в статусе `draft` / `rejected` никогда не возвращается decision API (property-based тест: случайные наборы статусов).
8. **Refresh token reuse**: использовать старый refresh после ротации → вся семья отозвана.
9. **Webhook payments**: один и тот же вебхук 3 раза → заказ переведён в `paid` один раз; невалидная подпись → 400.

### E2E-сценарии (Playwright)
1. Гость: каталог → товар → корзина → промокод → checkout → оплата → страница «спасибо» со статусом `paid`.
2. Мерчант: создать товар с вариантом → товар появляется на витрине (проверка revalidate).
3. Маркетолог: кампания → генерация креативов (FakeLlm) → approve → блок появляется на витрине → клик → счётчик в экспериментах растёт.
4. Live dashboard: запустить симулятор → в течение 5 сек events/sec > 0 и появляется лента.
5. Tenant isolation в UI: сотрудник RunHub не видит заказы HomeBrew даже при подмене URL.

Покрытие: считается, но в README не хвастаемся процентом. Указываем, какие модули покрыты и почему.

---

## Нагрузочное тестирование (k6, `infra/k6`)

### Сценарии

| Сценарий | Что меряем | Цель (ориентир, подтвердить на практике) |
|---|---|---|
| `collector-ramp.js` | Батчи по 20 событий, ramp до отказа | События/сек при p95 < 100 мс и 0% ошибок |
| `pipeline-e2e.js` | Постоянная нагрузка на collector + метрика `message_end_to_end_seconds` из Prometheus | Свежесть данных p95 < 2 сек при X событий/сек |
| `checkout-contention.js` | 200 VU покупают из пула 20 товаров | Throughput заказов, доля 409, отсутствие 5xx и deadlock |
| `decision-api.js` | GET decisions с разными профилями | p95 < 50 мс |
| `storefront-browse.js` | Смешанный трафик витрины | RPS при p95 < 200 мс |

### Отчёт в README (формат)

```text
Environment: Hetzner CPX41 (8 vCPU, 16 GB), all services in docker compose on one host
Date: 2026-MM-DD, commit abc123

| Scenario            | Throughput        | p50   | p95   | p99   | Errors |
|---------------------|-------------------|-------|-------|-------|--------|
| Collector ingest    | 9,400 events/s    | 8 ms  | 31 ms | 74 ms | 0.00%  |
| End-to-end freshness| at 5,000 events/s | 0.4 s | 1.1 s | 2.3 s | —      |
| Decision API        | 1,800 req/s       | 6 ms  | 18 ms | 35 ms | 0.00%  |

Bottleneck found: … (например, JSON-сериализация в collector / размер prefetch / индекс …)
Fix: … → result: +X%
```

**Раздел «Bottleneck investigation»** — самое ценное в README: flame graph (`0x` или `clinic flame`) до и после, что нашёл, что поменял. Пример реального поиска: подбирать размер батча ClickHouse и prefetch, найти, что `JSON.parse` на больших батчах блокирует event loop, и так далее.

---

## Chaos-сценарии (`infra/chaos/*.sh`)

| Сценарий | Ожидание | Как проверяем |
|---|---|---|
| `kill-stream-worker.sh`: `docker kill` во время нагрузки, потом рестарт | Нет потерь; дубли не попадают в аналитику | Счётчик отправленных симулятором == `count()` в ClickHouse после `FINAL` |
| `rabbitmq-down.sh`: остановить брокер на 60 сек | Collector буферизует → 503 при переполнении → SDK ретраит. Заказы создаются (outbox копит) | После восстановления: все доменные события доставлены, потеря трекинга ≤ заявленного |
| `clickhouse-down.sh`: остановить на 2 минуты | Сообщения уходят в retry → накапливаются → после восстановления дописываются | Queue depth растёт, затем падает до 0, DLQ пуст |
| `redis-flush.sh`: `FLUSHALL` | Профили восстанавливаются из снапшотов, bandit — из снапшота, idempotency страхуется уникальным индексом | Decision API продолжает работать, ошибок нет |
| `slow-consumer.sh`: искусственная задержка 200 мс в handler | Растёт lag, алерт срабатывает | Grafana-алерт |

Результаты в README: таблица «сценарий → ожидание → факт», со скриншотами Grafana.

---

## Observability

### Трейсинг (OpenTelemetry)
- Автоинструментация: HTTP (Nest, Fastify, Next.js server), pg, ioredis, amqplib (или ручные спаны в `packages/messaging`).
- **Propagation через RabbitMQ**: `traceparent` в headers сообщения; consumer создаёт span с link/parent. Через outbox: `traceparent` сохраняется в колонке `headers`.
- Результат — один трейс: `POST /checkout → INSERT outbox → relay publish → consume q.notifications → send email` и `POST /events → publish → consume analytics.ingest → ClickHouse insert`. **Скриншот такого трейса обязательно положить в README.**
- Экспорт: OTLP → Grafana Tempo (или Jaeger).

### Метрики (Prometheus)
- RED по HTTP: `http_requests_total`, `http_request_duration_seconds` (route, method, status).
- Очереди: см. `04-events-and-messaging.md`.
- Бизнес: `orders_placed_total`, `checkout_failures_total{reason}`, `llm_requests_total{outcome}`, `llm_cost_usd_total`, `decision_latency_seconds`.
- Runtime: event loop lag (`monitorEventLoopDelay`), heap, GC.
- Экспортеры: postgres_exporter, redis_exporter, rabbitmq_prometheus, ClickHouse встроенный.

### Логи
- pino (JSON), поля: `traceId`, `spanId`, `tenantId`, `requestId`, `userId`. Redaction паролей, токенов, email.
- Loki + Grafana, переход trace → logs по traceId.

### Дашборды Grafana (как код, `infra/grafana`)
1. **System overview**: RPS, ошибки, латентность по сервисам.
2. **Event pipeline**: ingest rate, queue depth, consumer rate, e2e freshness, DLQ.
3. **Business**: заказы, выручка, конверсия (из Prometheus-метрик).
4. **Personalization**: decision latency, распределение сегментов, LLM-запросы и стоимость.

### Алерты (примеры, Grafana alerting)
- `dlq_messages > 0` 5 мин
- `message_end_to_end_seconds p95 > 10s`
- 5xx rate > 1%
- `outbox` неопубликованных старше 1 мин > 0

### SLO (прописать в README)
- Storefront API availability 99.5%, p95 < 300 мс.
- Свежесть аналитики: 99% событий видны в дашборде < 5 сек.

---

## CI/CD (GitHub Actions)

```text
pr.yml
 ├─ setup (pnpm cache, turbo remote cache)
 ├─ lint + typecheck + dependency boundaries        (turbo, только затронутые пакеты)
 ├─ unit                                            (параллельно по пакетам)
 ├─ integration (Testcontainers, docker в runner)
 ├─ contract (OpenAPI diff, events fixtures)
 ├─ build (next build, nest build) + size-limit (tracker-sdk)
 ├─ e2e smoke (docker compose up → Playwright, артефакты: трейсы и видео при падении)
 └─ migrations check (применить на пустую БД, drizzle-kit check)

main.yml
 ├─ всё выше
 ├─ build & push Docker images → GHCR (теги: sha, latest)
 └─ deploy demo: ssh → docker compose pull && up -d → smoke test → при падении rollback на предыдущий тег

nightly.yml
 ├─ full e2e
 ├─ k6 short run (2 мин) → результаты артефактом, регрессия > 20% → issue
 └─ creatives eval (FakeLlm) + (опционально) реальная LLM на 5 фикстурах
```

- Renovate для зависимостей, CodeQL, `pnpm audit` в CI.
- Changesets не нужны (это приложение, не библиотека).
- Conventional Commits + commitlint.

---

## Docker и деплой

- Multi-stage Dockerfile на каждое приложение: `turbo prune --docker` → install → build → runtime на `node:22-alpine` (или distroless), non-root пользователь, healthcheck.
- Next.js в режиме `output: 'standalone'`.
- `docker-compose.yml` (dev): все зависимости + приложения с hot reload + Mailpit + MinIO + Grafana stack (профиль `observability`, чтобы по умолчанию не поднимать всё).
- `docker-compose.demo.yml`: prod-сборки + Caddy (автоматический TLS, поддомены тенантов `*.demo.domain` через wildcard-сертификат по DNS challenge или 2 фиксированных поддомена).
- Сброс демо: cron в 04:00 → `pnpm demo:reset` (truncate + seed + backfill 90 дней).
- Бэкапы Postgres на демо не нужны, данные seed-ятся заново.
- Секреты: `.env` на сервере вне репозитория, в CI — GitHub Secrets.
- Опционально `infra/terraform/aws`: VPC, ECS Fargate, RDS Postgres, ElastiCache, Amazon MQ (RabbitMQ), ClickHouse Cloud / EC2. Живое демо на этом **не** держим, это демонстрация IaC.
