# 10 · Демо и публичный README

## Сценарий видео (2:30–3:00)

Подготовка: симулятор в backfill заполнил 90 дней, live-режим запущен на ~10 сессий/сек, bandit уже поработал ~15 минут.

| Время | Экран | Что говорить (EN, коротко) |
|---|---|---|
| 0:00–0:15 | Архитектурная диаграмма | «Multi-tenant commerce platform with an event pipeline and a personalization engine. One monorepo, 8 apps.» |
| 0:15–0:40 | Витрина RunHub: товар → корзина → checkout → «paid» | «Checkout reserves stock atomically and is idempotent. Payment is confirmed by webhook.» |
| 0:40–1:00 | Live dashboard: событие этой покупки появляется в ленте, выручка растёт | «The order event went through a transactional outbox and RabbitMQ; tracking events land in ClickHouse in under two seconds.» |
| 1:00–1:15 | Grafana Tempo: один трейс от POST /checkout до consumer'а | «Traces propagate through the queue, so a single trace covers the whole flow.» |
| 1:15–1:40 | Кампания → Generate → 3 креатива с guardrail-флагами → Approve | «The LLM only proposes variants, and every variant needs human approval. Claims about prices are checked against real data.» |
| 1:40–2:10 | Экран эксперимента: доля трафика смещается, плотности Beta сужаются; regret Thompson vs uniform | «Thompson sampling picks the creative per segment. Compared with a uniform A/B test, it lost 7x fewer clicks on simulated traffic.» |
| 2:10–2:25 | «Ground truth vs learned» | «The simulator has hidden preferences per persona, and the system discovered them without being told.» |
| 2:25–2:40 | Витрина → «Why this?» | «Every decision is explainable with the real signals behind it.» |
| 2:40–3:00 | Терминал: `docker kill stream-worker` → график queue depth → рестарт → 0 потерь | «Resilience is tested too: killing a worker loses no events and creates no duplicates.» |

Запись: 1080p, крупный шрифт в терминале, без музыки или тихая музыка, субтитры.

## Скриншоты и GIF для README

1. **Hero GIF** (≤ 8 сек): Live dashboard с движущимся графиком и лентой.
2. Экран эксперимента (arms + доля трафика).
3. Карточка креатива с guardrail-флагами.
4. Трейс в Tempo.
5. «Why this ad?» панель.
6. Grafana Event pipeline во время chaos-теста.

## Структура публичного README (EN)

```markdown
# Commerce Intelligence Platform
Multi-tenant commerce platform with a reliable event pipeline, real-time analytics
and a self-learning personalization engine.

[badges]  [hero GIF]
Live demo · 3-min video · Architecture · ADRs

## Highlights
- **Tenant isolation enforced by PostgreSQL Row-Level Security**, not only by application code
- **No overselling**: atomic stock reservation, verified by a 100-concurrent-checkout test
- **No lost events**: transactional outbox → RabbitMQ with publisher confirms, retries with backoff, DLQ and replay
- **Real-time analytics**: ClickHouse + Redis, events visible on the dashboard in < 2 s (p95)
- **LLM proposes, humans approve, bandits decide**: generated creatives pass guardrails
  and review; Thompson sampling selects per segment
- **Explainable decisions**: every ad and recommendation stores the signals behind it
- **End-to-end tracing across the message queue** with OpenTelemetry
- **Measured**: load tests and chaos experiments with published numbers

## Architecture          (Mermaid diagram + 1 paragraph)
## How personalization works (5 bullet steps + link to docs)
## Tech stack            (table: layer / tech / why)
## Run locally           (3 commands)
## Testing               (levels + invariants list)
## Performance           (table + environment + bottleneck story)
## Resilience            (chaos table)
## Architecture decisions (ADR list)
## Known limitations & next steps
## Non-goals
```

## Known limitations (черновик честного раздела)

- Outbox relay: при большом числе тенантов стал бы узким местом. Следующий шаг — CDC (Debezium) или партиционирование.
- Ранжирование — ручные веса, а не обученная модель. На реальных данных нужен learning-to-rank и офлайн-оценка (NDCG).
- Bandit не контекстный внутри сегмента (сегмент = контекст). Следующий шаг — LinUCB или contextual Thompson по признакам профиля.
- Задержанная обратная связь для конверсий искажает оценки в первые 24 ч.
- Метрики персонализации получены на симулированном трафике.
- Один регион, один инстанс Postgres. RLS добавляет накладные расходы (замерено: X%).
- Полнотекстовый поиск Postgres не заменяет поисковый движок для больших каталогов (> 100k SKU).

## Вопросы на интервью, к которым проект готовит

- Почему outbox, а не «опубликовать после commit»? Что будет при падении между commit и publish?
- At-least-once vs exactly-once: как у тебя достигается effectively-once?
- Как RLS работает с пулом соединений? (`SET LOCAL` в транзакции против `SET` на соединении — утечка контекста между запросами)
- Почему ReplacingMergeTree не гарантирует отсутствие дублей в запросе?
- Как избежать deadlock при резервировании нескольких товаров?
- Чем Thompson sampling лучше A/B-теста и когда хуже? (A/B даёт чистую статистическую оценку для решения; bandit оптимизирует награду во время теста)
- Как кэшировать страницу, на которой есть персональный блок?
- Что будет, если LLM сгенерирует несуществующую скидку?
- Как масштабировать WebSocket-gateway горизонтально?
- Почему prefetch должен быть не меньше размера батча?
