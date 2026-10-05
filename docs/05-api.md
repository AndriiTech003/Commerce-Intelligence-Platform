# 05 · API

## Общие соглашения

- Базовый путь: `/v1`. Версионирование через URL (просто и явно).
- Две поверхности:
  - **Admin API** `/v1/admin/*` — JWT сотрудника + заголовок `X-Tenant-Id` (проверяется membership) или `sk_` ключ.
  - **Storefront API** `/v1/storefront/*` — тенант определяется по хосту (`runhub.localhost`) или заголовку `X-Store` (для SSR); покупатель — JWT покупателя (опционально); анонимный — `anonymous_id` cookie.
- Collector: `POST /v1/events` на отдельном хосте/порте, ключ `pk_`.
- OpenAPI генерируется из zod-схем (`@anatine/zod-openapi` / `nestjs-zod`) → Swagger UI на `/docs`. Из OpenAPI генерируется типизированный клиент для фронтов (`openapi-typescript` + `openapi-fetch`) — **фронт и бэк не расходятся по типам**.

### Формат ошибок (RFC 9457 Problem Details)

```json
{
  "type": "https://docs.example.dev/errors/insufficient-stock",
  "title": "Insufficient stock",
  "status": 409,
  "code": "INSUFFICIENT_STOCK",
  "detail": "Some items are no longer available in the requested quantity",
  "instance": "/v1/storefront/checkout",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [{ "variantId": "…", "requested": 3, "available": 1 }]
}
```

Доменные ошибки — классы в `domain/`, маппинг в HTTP — в одном exception filter. Никаких `throw new HttpException` в domain/application.

### Пагинация

- Списки в админке — **cursor-based** (`?limit=50&cursor=…`), курсор = base64(`{sortValue, id}`). Ответ: `{ data: [], nextCursor: string | null }`.
- Offset-пагинация только там, где нужен «номер страницы» и данных мало (не используем).
- Сортировка `?sort=-created_at`, фильтры — явные параметры (`?status=paid&from=…`), без универсального query-языка.

### Идемпотентность

- `Idempotency-Key` обязателен: `POST /storefront/checkout`, `POST /admin/orders/:id/refund`.
- Опционален: остальные POST.
- Повтор с тем же ключом и **тем же телом** → сохранённый ответ + заголовок `Idempotent-Replayed: true`.
- С тем же ключом и **другим телом** → `422 IDEMPOTENCY_KEY_REUSED`.
- Запрос с ключом ещё выполняется → `409 IDEMPOTENCY_IN_PROGRESS`.

### Rate limiting

- Login: 5 попыток / 15 мин на email+IP.
- Storefront API: 300 req/min на IP.
- Collector: 1000 событий/сек на ключ (burst 2000).
- Заголовки `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (IETF draft).

### Прочее

- `ETag` + `If-None-Match` на карточке товара и каталоге (storefront).
- `If-Match` на обновлении товара в админке → `412` при конфликте (оптимистичная блокировка по `updated_at`/версии) — два менеджера не перетрут изменения друг друга.
- Каждый ответ содержит `X-Request-Id` и `traceparent`.

---

## Endpoints

### Auth & tenancy

| Метод | Путь | Описание |
|---|---|---|
| POST | `/v1/auth/signup` | Регистрация мерчанта: user + tenant + membership(owner) |
| POST | `/v1/auth/login` | → access token + refresh cookie |
| POST | `/v1/auth/refresh` | Ротация refresh; повторное использование старого → отзыв семьи |
| POST | `/v1/auth/logout` | Отзыв refresh |
| GET | `/v1/me` | Профиль + список тенантов и ролей |
| POST | `/v1/admin/invitations` | Пригласить сотрудника |
| POST | `/v1/invitations/:token/accept` | Принять приглашение |
| GET/PATCH/DELETE | `/v1/admin/members[/:userId]` | Сотрудники и роли |
| GET/POST/DELETE | `/v1/admin/api-keys[/:id]` | Ключи (секрет показывается один раз) |
| GET | `/v1/admin/audit-log` | Журнал действий (фильтры: actor, entity, период) |
| GET/PATCH | `/v1/admin/settings` | Настройки магазина |

### Catalog & inventory (admin)

| Метод | Путь | Описание |
|---|---|---|
| GET/POST | `/v1/admin/categories` | Дерево / создание |
| PATCH/DELETE | `/v1/admin/categories/:id` | |
| GET | `/v1/admin/products` | Список: `q`, `status`, `categoryId`, `lowStock`, cursor |
| POST | `/v1/admin/products` | Создать (с вариантами) |
| GET/PATCH/DELETE | `/v1/admin/products/:id` | `PATCH` с `If-Match` |
| POST | `/v1/admin/products/:id/images` | Presigned URL для загрузки в S3/MinIO |
| POST | `/v1/admin/products/import` | CSV → job id |
| GET | `/v1/admin/jobs/:id` | Статус фоновой задачи (прогресс, ошибки по строкам) |
| GET | `/v1/admin/inventory` | Остатки с фильтрами |
| POST | `/v1/admin/inventory/:variantId/adjust` | `{delta, reason}` |
| GET | `/v1/admin/inventory/:variantId/movements` | История движений |

### Discounts, orders, customers (admin)

| Метод | Путь | Описание |
|---|---|---|
| GET/POST | `/v1/admin/discounts` | |
| PATCH/DELETE | `/v1/admin/discounts/:id` | |
| GET | `/v1/admin/orders` | Фильтры: status, период, customer, сумма |
| GET | `/v1/admin/orders/:id` | С историей статусов, платежами, атрибуцией |
| POST | `/v1/admin/orders/:id/transitions` | `{to: 'fulfilled', note}` — через статусную машину |
| POST | `/v1/admin/orders/:id/refund` | Idempotency-Key |
| GET | `/v1/admin/customers` | |
| GET | `/v1/admin/customers/:id` | Заказы, LTV |
| GET | `/v1/admin/customers/:id/timeline` | Последние события (ClickHouse) |
| GET | `/v1/admin/customers/:id/profile` | Профиль персонализации + сегменты |

### Analytics (admin, ClickHouse)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/admin/analytics/overview?from&to&compare=prev` | Выручка, заказы, AOV, конверсия + дельта |
| GET | `/v1/admin/analytics/timeseries?metric=revenue&interval=day` | Графики |
| GET | `/v1/admin/analytics/funnel?from&to` | Воронка |
| GET | `/v1/admin/analytics/top-products?by=revenue` | |
| GET | `/v1/admin/analytics/cohorts?period=week` | Retention |
| GET | `/v1/admin/analytics/live` | Снимок live-метрик (первичная загрузка до WS) |
| GET | `/v1/admin/analytics/insights` | AI Insights (кэш 1ч) |

Кэш аналитических ответов в Redis 30–60 сек (ключ = tenant + нормализованные параметры).

### Personalization & campaigns (admin)

| Метод | Путь | Описание |
|---|---|---|
| GET/POST | `/v1/admin/segments` | Правила сегментов |
| POST | `/v1/admin/segments/preview` | Сколько профилей попадает (по снапшотам) |
| GET/POST | `/v1/admin/campaigns` | |
| GET/PATCH | `/v1/admin/campaigns/:id` | Статус: activate/pause |
| POST | `/v1/admin/campaigns/:id/creatives/generate` | `{segments[], tones[], count}` → LLM, возвращает черновики |
| POST | `/v1/admin/campaigns/:id/creatives` | Ручной креатив |
| PATCH | `/v1/admin/creatives/:id` | Редактирование черновика |
| POST | `/v1/admin/creatives/:id/review` | `{decision: approve\|reject, comment}` — permission `marketing:approve` |
| GET | `/v1/admin/campaigns/:id/experiment` | Arms по сегментам: α, β, показы, CTR, 95% интервал, P(best), доля трафика во времени |
| GET | `/v1/admin/decisions/:decisionId` | «Why this ad?» — полное объяснение показа |

### Storefront

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/storefront/catalog/categories` | |
| GET | `/v1/storefront/catalog/products?category&q&sort&priceMin&priceMax&cursor` | |
| GET | `/v1/storefront/catalog/products/:slug` | ETag |
| GET | `/v1/storefront/search/suggest?q=` | Автодополнение (trigram) |
| GET | `/v1/storefront/cart` | Текущая корзина (по customer или anonymous_id) |
| POST | `/v1/storefront/cart/items` | `{variantId, quantity}` |
| PATCH/DELETE | `/v1/storefront/cart/items/:variantId` | |
| POST | `/v1/storefront/cart/discount` | Применить промокод |
| POST | `/v1/storefront/checkout` | Idempotency-Key → заказ + payment client secret |
| GET | `/v1/storefront/orders/:id` | Статус заказа (для страницы «спасибо», polling/SSE) |
| POST | `/v1/storefront/auth/register`, `/login`, `/refresh`, `/logout` | Покупатели; при логине — merge корзины + `customer.identified` |
| GET | `/v1/storefront/account/orders` | История |
| GET | `/v1/storefront/decisions?placement=…` | Персонализированный блок (креатив + товары + decisionId) |
| GET | `/v1/storefront/recommendations?type=for_you\|similar\|bought_together&productId=` | |

### Payments

| Метод | Путь | Описание |
|---|---|---|
| POST | `/v1/payments/webhooks/:provider` | Проверка подписи, идемпотентность по `provider_event_id` |
| POST | `/v1/payments/fake/:intentId/confirm` | Только FakeProvider: имитация оплаты формой на витрине |

### Collector

| Метод | Путь | Описание |
|---|---|---|
| POST | `/v1/events` | Батч до 50 событий, ≤ 64 KB; `202 {accepted, rejected:[{index, reason}]}` |
| GET | `/health/live`, `/health/ready` | ready = есть соединение с RabbitMQ |

### Platform / ops

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/platform/tenants` | Только platform admin |
| GET | `/v1/platform/dlq` | Очереди DLQ и количество |
| GET | `/v1/platform/dlq/:queue/messages?limit=20` | Просмотр (peek) |
| POST | `/v1/platform/dlq/:queue/replay` | `{messageIds[] \| all}` |
| POST | `/v1/platform/simulator` | `{action: start\|stop, rate, personas{}}` |
| GET | `/health/live`, `/health/ready`, `/metrics` | Все сервисы |

---

## Webhooks мерчанта (исходящие, domain-worker)

- Мерчант регистрирует URL и события (`order.paid`, `order.refunded`).
- Подпись `X-Signature: t=…,v1=HMAC_SHA256(secret, t + '.' + body)` (как у Stripe), защита от replay по `t`.
- Ретраи с экспоненциальным backoff (1м, 5м, 30м, 2ч, 12ч), после — `disabled` + уведомление.
- Лог доставок в админке с кнопкой «Resend».

Это «плюс» при наличии времени (M7), но показывает хорошую инженерию интеграций.
