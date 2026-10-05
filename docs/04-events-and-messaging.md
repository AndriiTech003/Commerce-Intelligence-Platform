# 04 · События и RabbitMQ

## Два вида событий

| | Трекинг-события (`track.*`) | Доменные события (`domain.*`) |
|---|---|---|
| Источник | Браузер (tracker-sdk), симулятор | API (через outbox) |
| Объём | Высокий (тысячи/сек) | Низкий (десятки/сек) |
| Потеря допустима? | Единичные — да (браузер закрылся) | **Нет** |
| Гарантия | At-least-once от collector'а до брокера | At-least-once через outbox + идемпотентные consumers |
| Примеры | `product_viewed`, `ad_clicked` | `order.placed`, `order.paid`, `inventory.low_stock` |

## Общий конверт (envelope)

Схема в `packages/contracts/src/events/envelope.ts` (zod), из неё же генерируется JSON Schema для документации.

```ts
type EventEnvelope<TType extends string, TProps> = {
  event_id: string;          // UUIDv7, генерирует источник (браузер/API) → основа дедупликации
  event_type: TType;
  schema_version: number;    // 1, 2… — consumers поддерживают N и N-1
  tenant_id: string;         // collector проставляет по API-ключу, клиенту НЕ доверяем
  occurred_at: string;       // ISO, время у источника
  received_at?: string;      // проставляет collector
  anonymous_id?: string;
  customer_id?: string;
  session_id?: string;
  context?: {
    page?: { url: string; path: string; referrer?: string; title?: string };
    user_agent?: string; locale?: string; country?: string; device?: 'desktop' | 'mobile' | 'tablet';
    campaign?: { utm_source?: string; utm_medium?: string; utm_campaign?: string };
  };
  properties: TProps;
};
```

Правила:
- `occurred_at` из браузера может быть неверным (часы клиента). Если расходится с `received_at` больше чем на 24ч → заменяем на `received_at` и ставим флаг `clock_skew` в properties.
- Изменение схемы — только аддитивное в рамках версии. Ломающее → `schema_version + 1`, consumers обрабатывают обе версии минимум один релиз.
- **Contract tests**: каждый consumer имеет фикстуры событий всех поддерживаемых версий, тесты прогоняют их через обработчик.

## Каталог трекинг-событий

| event_type | properties | Кто потребляет |
|---|---|---|
| `page_viewed` | `{ page_type: 'home'\|'category'\|'product'\|'cart'\|'checkout'\|'other' }` | analytics, realtime |
| `product_viewed` | `{ product_id, variant_id?, category_path, price_cents, brand? }` | analytics, profile, reco |
| `product_list_viewed` | `{ list_id, category_path?, product_ids[] }` | analytics |
| `search_performed` | `{ query, results_count }` | analytics, profile |
| `cart_item_added` | `{ product_id, variant_id, quantity, price_cents, category_path }` | analytics, profile, realtime |
| `cart_item_removed` | `{ product_id, variant_id, quantity }` | analytics, profile |
| `checkout_started` | `{ cart_id, value_cents, items_count }` | analytics, profile |
| `ad_impression` | `{ decision_id, campaign_id, creative_id, placement, segment_key }` | analytics, bandit |
| `ad_clicked` | `{ decision_id, campaign_id, creative_id, placement, segment_key }` | analytics, bandit, profile |
| `recommendation_clicked` | `{ decision_id, product_id, position, strategy }` | analytics |

## Каталог доменных событий

| event_type | payload | Потребители |
|---|---|---|
| `order.placed` | `{ order_id, number, customer_id?, profile_id, items[{product_id, variant_id, qty, unit_price_cents, category_path}], total_cents, currency, attribution? }` | analytics (как `order_placed`), profile, bandit (конверсия), notifications |
| `order.paid` | `{ order_id, amount_cents }` | analytics (revenue), notifications, realtime |
| `order.cancelled` | `{ order_id, reason }` | analytics, inventory |
| `order.refunded` | `{ order_id, amount_cents }` | analytics (отрицательная выручка), inventory |
| `order.fulfilled` | `{ order_id }` | notifications |
| `inventory.low_stock` | `{ variant_id, available, threshold }` | notifications (админка) |
| `product.upserted` | `{ product_id, changed_fields[] }` | embeddings, reco-кэш |
| `customer.identified` | `{ customer_id, anonymous_id }` | profile (склейка анонимного и known профиля) |
| `creative.approved` | `{ creative_id, campaign_id }` | bandit (инициализация arm) |

## Топология RabbitMQ

Описана как код: `infra/rabbitmq/definitions.json`, загружается при старте контейнера. Приложения **не** создают топологию сами (кроме проверки `checkQueue` на старте).

```text
Exchanges
├── track            (topic, durable)      — трекинг-события, routing key = event_type
├── domain           (topic, durable)      — доменные события, routing key = event_type (order.placed)
├── retry            (direct, durable)     — возврат сообщений на повтор
└── dlx              (direct, durable)     — окончательно упавшие сообщения

Queues (все quorum, delivery-limit = 10 как страховка)
├── q.analytics.ingest     ← track.#, domain.order.#            consumer: stream-worker (prefetch 500, batch)
├── q.realtime.counters    ← track.#, domain.order.paid          consumer: stream-worker (prefetch 200)
├── q.profile.update       ← track.product_viewed, track.cart_*, track.search_performed,
│                            track.ad_clicked, domain.order.placed, domain.customer.identified
│                                                                consumer: stream-worker
├── q.bandit.feedback      ← track.ad_impression, track.ad_clicked, domain.order.placed,
│                            domain.creative.approved             consumer: api (personalization)
├── q.notifications        ← domain.order.*, domain.inventory.low_stock   consumer: domain-worker
├── q.catalog.embeddings   ← domain.product.upserted              consumer: domain-worker
├── q.reco.cooccurrence    ← track.product_viewed, domain.order.placed    consumer: stream-worker
│
├── q.<name>.retry.5s      (x-message-ttl 5000,   x-dead-letter-exchange "" → q.<name>)
├── q.<name>.retry.30s     (x-message-ttl 30000)
├── q.<name>.retry.5m      (x-message-ttl 300000)
└── q.<name>.dlq           ← dlx, routing key <name>
```

> Retry-очереди с TTL, а не плагин delayed-message: плагин не реплицируется в quorum-очередях и не входит в стандартный образ. ADR-006.

## Поведение consumer'а (пакет `packages/messaging`)

```ts
consume('q.profile.update', {
  prefetch: 200,
  handler: async (msg, ctx) => { … },           // бросает ошибку → ретрай
  retry: { delays: ['5s', '30s', '5m'] },         // после — в DLQ
  classifyError: (e) => e instanceof ValidationError ? 'poison' : 'retryable',
  idempotency: { store: 'redis', keyTtl: '48h' },  // или 'postgres' (processed_messages) для domain
});
```

Алгоритм обработки одного сообщения:

1. Извлечь `traceparent` из headers → продолжить трейс (OTel span `consume q.profile.update`).
2. Распарсить и провалидировать по zod. Невалидно → **poison** → сразу в DLQ с заголовком `x-error`.
3. Проверить дедуп (`SET dedup:{consumer}:{event_id} NX EX …`). Уже было → ack, метрика `messages_duplicate_total`.
4. Выполнить handler.
5. Успех → ack.
6. Retryable-ошибка → publish в `retry` с `x-retry-count+1` в нужную retry-очередь → ack оригинала. Если попытки кончились → publish в `dlx` → ack.
7. Процесс упал посередине → сообщение не ack'нуто → RabbitMQ вернёт его → дедуп (шаг 3) защищает от двойной обработки там, где эффект уже применён.

> Важно: дедуп-ключ ставится **после** успешного выполнения для неидемпотентных эффектов, или handler сам идемпотентен (upsert, `INSERT … ON CONFLICT DO NOTHING`). Для доменных consumers используем `processed_messages` в **той же** транзакции Postgres, что и эффект — это настоящий effectively-once. Разобрать в ADR-005.

Graceful shutdown: SIGTERM → `channel.cancel(consumerTag)` → дождаться in-flight handlers (таймаут 25 сек) → закрыть канал и соединение → exit 0.

## Публикация

- **Publisher confirms** обязательны (`createConfirmChannel`). Collector отвечает 202 только после confirm.
- Если брокер недоступен, collector:
  - держит in-memory буфер до N сообщений (например 10 000) с ретраями;
  - при переполнении отвечает `503` + `Retry-After` → tracker-sdk повторит позже;
  - метрика `collector_buffer_size`, алерт.
- `mandatory: true` + обработчик `return` — ловим сообщения без маршрута (ошибка конфигурации).
- В headers: `traceparent`, `tenant_id`, `event_type`, `schema_version`, `x-retry-count`.

## Transactional Outbox

```text
API транзакция:
  INSERT orders …
  INSERT outbox (id=event_id, event_type='order.placed', payload, headers{traceparent})
COMMIT

domain-worker (outbox relay), цикл:
  BEGIN
  SELECT * FROM outbox WHERE published_at IS NULL
    ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
  publish каждый → ждать confirms
  UPDATE outbox SET published_at = now() WHERE id = ANY($ids)
  COMMIT
  если выбрано 0 → sleep 200ms (или LISTEN/NOTIFY для мгновенной реакции)
```

- `SKIP LOCKED` позволяет запустить несколько relay-воркеров.
- Если publish упал → транзакция откатывается, `attempts++` отдельным запросом, backoff.
- Порядок: гарантируется примерно (по `created_at`); consumers не полагаются на строгий порядок (статусы заказов проверяют допустимость перехода и игнорируют устаревшие).
- `pg_notify('outbox', '')` из триггера → relay слушает `LISTEN outbox` → латентность ~десятки мс без агрессивного поллинга.

## Stream-worker: пакетная запись в ClickHouse

- Буфер в памяти, flush при **1000 событий или 1 сек**, что наступит раньше.
- Ack сообщений **после** успешного insert в ClickHouse (ack с `multiple: true` по последнему delivery tag батча).
- Insert упал → nack всего батча с requeue=false → retry-очередь.
- `prefetch` ≥ размер батча, иначе батч никогда не наберётся (частая ошибка — отметить в ADR/README).
- ClickHouse `async_insert` не используем — батчим сами (контроль ack'ов). Альтернатива в ADR.

## Realtime-агрегация

Stream-worker на каждое событие:
```text
HINCRBY rt:{t}:ev:{sec} {event_type} 1          (EXPIRE 600)
PFADD   rt:{t}:active:{min} {profile_id}         (EXPIRE 600)
INCRBY  rt:{t}:revenue:{day} {amount}            (для order.paid)
LPUSH + LTRIM rt:{t}:feed …                      (сэмплинг: не более 20/сек на тенант)
```
Команды в pipeline по батчу. Раз в секунду отдельный таймер собирает агрегат за последнюю секунду по активным тенантам и делает `PUBLISH rt:{t}:tick {json}` → gateway рассылает подписанным админкам.

## Наблюдаемость очередей

Метрики (Prometheus, из приложения + rabbitmq_prometheus plugin):
- `queue_messages_ready`, `queue_messages_unacked` по очередям
- `messages_consumed_total{queue, outcome=ack|retry|dlq|duplicate}`
- `message_processing_seconds` (histogram)
- `message_end_to_end_seconds` = now − occurred_at (histogram) — **главная метрика свежести данных**
- `dlq_messages` → алерт при > 0

Админ-страница (Platform admin): список DLQ с количеством, просмотр сообщения, кнопка **Replay** (перекладывает обратно в основную очередь) — очень хорошо смотрится на демо.
