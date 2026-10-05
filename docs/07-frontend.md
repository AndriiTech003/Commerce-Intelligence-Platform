# 07 · Frontend

Два Next.js-приложения с общими пакетами `ui` и `contracts`, а также сгенерированным API-клиентом. Цель — показать, что фронт здесь не «формочки к API», а продуманная часть системы.

## Общий стек

| Задача | Выбор |
|---|---|
| Фреймворк | Next.js 15 (App Router, React 19, Server Components, Server Actions там, где уместно) |
| Стили / UI | Tailwind + shadcn/ui (свои обёртки в `packages/ui`), lucide-icons |
| Серверное состояние (admin) | TanStack Query v5: кэш, инвалидация, optimistic updates |
| Таблицы | TanStack Table + виртуализация (TanStack Virtual) для больших списков |
| Формы | react-hook-form + zod (схемы из `packages/contracts`) |
| Графики | ECharts (realtime, много точек) или Recharts (простые) |
| API-клиент | `openapi-fetch` с типами, сгенерированными из OpenAPI |
| Realtime | Свой хук `useLiveChannel` поверх WebSocket с reconnect и resume |
| Тесты | Vitest + Testing Library (компоненты, хуки), Playwright (E2E), Storybook (опционально, для `ui`) |
| Качество | Lighthouse CI для витрины (бюджет: LCP < 2.5s, CLS < 0.1), axe для a11y |

---

## Storefront (`apps/storefront`)

### Мультитенантность на фронте
- `middleware.ts` определяет магазин по хосту (`runhub.localhost:3000`, в проде `runhub.demo.domain`) и пробрасывает его в заголовок `x-store`.
- Настройки магазина (название, цвета, логотип) приходят с API и задаются через CSS-переменные — у двух демо-магазинов разный вид без отдельных тем.

### Страницы

| Страница | Рендеринг | Детали |
|---|---|---|
| Главная | ISR 60s + клиентский персональный блок | Hero-блок кампании (`home_hero`), «Для вас», популярное |
| Категория | ISR, фильтры в URL (`?price=50-150&brand=…&sort=`) | Фасеты, бесконечная прокрутка с cursor, скелетоны |
| Товар (PDP) | ISR + `revalidateTag('product:{id}')` при изменении в админке | Галерея, выбор варианта, остатки, «Похожие», «С этим покупают», блок кампании `pdp_sidebar` |
| Поиск | SSR | Автодополнение с debounce и отменой запросов (AbortController) |
| Корзина | Client | Optimistic изменение количества, откат при ошибке, пересчёт цен, промокод, upsell (`cart_upsell`) |
| Checkout | Client, multi-step | Адрес → доставка → оплата (Fake/Stripe Elements), Idempotency-Key генерируется **один раз на попытку** и хранится в sessionStorage, чтобы двойной клик и перезагрузка не создали второй заказ |
| Спасибо / статус заказа | Client | Ждёт вебхук оплаты: SSE или polling с backoff, пока статус `pending_payment` |
| Аккаунт | SSR (auth) | Заказы, выход |

### Персонализированные блоки
- **Статичная часть страницы кэшируется, персональный блок — нет.** Блок грузится отдельно: RSC с `Suspense` и `cache: 'no-store'` или клиентский запрос. Кэш страницы не «протекает» между пользователями. Это стоит описать в ADR, про это часто спрашивают.
- Impression отправляется, когда блок **реально виден** (IntersectionObserver, ≥ 50% площади на ≥ 1 секунду), а не при рендере. Это честная метрика.
- Demo-режим (`?demo=1` или переключатель): иконка «ⓘ Why this?» открывает панель с объяснением решения.

### tracker-sdk (`packages/tracker-sdk`)
- `tracker.init({ key: 'pk_…', endpoint })`, `tracker.track(type, props)`, `tracker.identify(customerId)`, `tracker.page()`.
- `anonymous_id` в first-party cookie (1 год), `session_id` — 30 минут неактивности.
- Очередь в памяти + дублирование в `localStorage`, чтобы события не терялись при закрытии вкладки.
- Flush: 20 событий / 5 секунд / `visibilitychange=hidden` (через `navigator.sendBeacon`).
- Ретраи с экспоненциальным backoff и jitter, уважение `Retry-After`.
- `event_id` (UUIDv7) генерируется на клиенте, поэтому ретраи не создают дублей.
- Размер ≤ 3 KB gzip (проверка `size-limit` в CI). Без зависимостей.
- Уважение `navigator.doNotTrack` / consent-флага (баннер cookie-consent на витрине).
- Unit-тесты с фейковыми таймерами и замоканным `fetch`/`sendBeacon`.

---

## Admin (`apps/admin`)

### Layout
- Sidebar: Dashboard, Live, Orders, Products, Inventory, Customers, Discounts, Marketing (Campaigns, Segments, Review queue), Analytics, Settings (Team, API keys, Webhooks, Audit log), Platform (только platform admin: Tenants, DLQ, Simulator).
- Переключатель тенанта в шапке. При переключении — `queryClient.clear()` и новый `X-Tenant-Id`.
- Command palette (⌘K): переход к заказу по номеру, к товару по названию.
- Пункты меню скрываются по permissions. На бэке это всё равно проверяется, а скрытие на фронте нужно только для UX.

### Экраны (ключевые)

**1. Live Dashboard.** Главный экран для демо.
- KPI-плитки: Active visitors (5 min), Events/sec, Revenue today, Orders today. Числа анимируются при изменении.
- Линейный график events/sec за последние 5 минут со скользящим окном, обновление каждую секунду.
- Лента событий («Someone from 🇩🇪 added *Trail Runner X* to cart»), не больше 1 новой строки в 200 мс, иначе нечитаемо.
- Мини-воронка за последний час.
- Индикатор соединения: live / reconnecting / offline. При reconnect догружает пропущенное через REST `analytics/live`.

Технически:
- Кольцевой буфер точек на 300 секунд, ECharts обновляется через `setOption` с `notMerge: false`, без пересоздания графика.
- Входящие сообщения батчатся в `requestAnimationFrame`, чтобы не делать ре-рендер на каждое сообщение.
- Вкладка неактивна → подписка на тики ставится на паузу (Page Visibility API), при возврате — ресинхронизация.

**2. Orders.**
- Таблица: cursor-пагинация, фильтры в URL, сохранённые представления («Unfulfilled», «Failed payments»).
- Карточка заказа: таймлайн статусов, платежи, позиции, атрибуция («пришёл с кампании X, креатив Y»), кнопки перехода статуса только из допустимых состояний (машина состояний общая с бэком, лежит в `contracts`).
- Refund: модалка подтверждения, Idempotency-Key.

**3. Products.**
- Таблица с inline-редактированием цены и остатка (optimistic, откат при ошибке).
- Форма товара: варианты (динамический массив полей), загрузка изображений напрямую в S3 по presigned URL с прогрессом и drag-n-drop сортировкой, markdown-редактор описания с превью.
- Конфликт редактирования: `412` → модалка «Товар изменён другим пользователем» с diff и выбором «Перезаписать / Загрузить новую версию».
- CSV-импорт: загрузка → прогресс-бар по статусу job → отчёт по ошибкам строк.

**4. Customers → Customer detail.**
- Заказы, LTV.
- **Профиль персонализации**: радар или бар-чарт аффинити к категориям, price band, intent-метр, список сегментов и правила, по которым покупатель в них попал.
- Таймлайн последних событий из ClickHouse.

**5. Campaigns.**
- Мастер создания: placement → товары (селектор с превью найденных товаров) → сегменты → цель (click/conversion).
- **Генерация креативов**: выбор сегментов и тонов → кнопка Generate → карточки вариантов появляются по мере готовности (стриминг или polling job) → в каждой карточке guardrail-флаги, rationale от LLM, кнопки Edit / Approve / Reject.
- **Превью креатива** в реальном виде блока витрины (общий компонент из `packages/ui`).

**6. Experiment view (внутри кампании).**
- Для каждого сегмента: таблица arms (показы, клики, CTR ± интервал Уилсона, P(best)).
- Stacked area chart «доля трафика по креативам во времени». На нём видно, как bandit смещает трафик.
- Графики плотности Beta-распределений каждого arm (SVG, считаются на клиенте), видно, как они сужаются.
- В режиме симулятора: график cumulative regret Thompson vs Uniform A/B.

**7. Segments.** Конструктор правил (вложенные группы all/any, выбор признака/оператора/значения) с живым превью «≈ 1 240 профилей» (debounce).

**8. Analytics.** Выбор периода + сравнение с прошлым, воронка, когортная таблица (heatmap), топ товаров, AI Insights с раскрывающимися «на основе каких цифр».

**9. Platform → DLQ.** Очереди и количество сообщений, просмотр JSON сообщения с заголовками ошибки, Replay выбранных или всех.

**10. Platform → Simulator.** Старт/стоп, слайдер sessions/sec, доли персон, кнопка «Shift preferences», таблица «Ground truth vs learned».

### Паттерны, которые стоит показать в коде
- `useLiveChannel(channel)` — reconnect с backoff и jitter, heartbeat, resume, статус соединения.
- Optimistic updates с откатом (`onMutate` / `onError` / `onSettled`).
- Инвалидация через query keys factory (`queryKeys.orders.detail(id)`).
- Error boundaries по секциям, чтобы падение одного виджета не роняло весь дашборд.
- Состояния загрузки, пустые состояния и ошибки везде продуманы (skeleton, empty state с CTA).
- Доступность: фокус в модалках, навигация с клавиатуры в таблицах, контраст.
- Тёмная тема.

### Auth во фронте
- Access token в памяти, refresh — httpOnly cookie. Silent refresh по 401 с единственным in-flight refresh (очередь запросов ждёт его, а не отправляет 10 refresh параллельно).
- Next.js middleware защищает роуты админки (проверяет наличие refresh cookie, при отсутствии — redirect на login).
