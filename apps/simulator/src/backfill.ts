import { EXCHANGES, MESSAGE_HEADERS, uuidv7 } from '@cip/contracts';
import { AmqpClient, Publisher } from '@cip/messaging';
import type { Logger } from '@cip/observability';
import { pickPersona, pickProduct, planSession, type Random } from './behaviour';
import type { StoreClient } from './client';
import type { Persona } from './personas';

export interface BackfillOptions {
  days: number;
  sessionsPerDay: number;
  rabbitUrl: string;
  rand: Random;
  logger?: Logger;
  now?: number;
}

type Message = { exchange: string; routingKey: string; body: Record<string, unknown> };

export function backfillSession(
  client: StoreClient,
  persona: Persona,
  rand: Random,
  start: number,
  visitorId: string,
): Message[] {
  const info = client.info!;
  const sessionId = uuidv7();
  const plan = planSession(persona, rand);
  const out: Message[] = [];
  let t = start;
  const tick = () => {
    t += 5_000 + Math.floor(rand() * 60_000);
    return new Date(t).toISOString();
  };
  const track = (type: string, properties: Record<string, unknown>) => {
    const occurred = tick();
    out.push({
      exchange: EXCHANGES.track,
      routingKey: type,
      body: {
        event_id: uuidv7(),
        event_type: type,
        schema_version: 1,
        tenant_id: info.id,
        occurred_at: occurred,
        received_at: occurred,
        anonymous_id: visitorId,
        session_id: sessionId,
        context: {
          page: { url: `http://${info.slug}.localhost/`, path: '/' },
          device: rand() < 0.6 ? 'mobile' : 'desktop',
          country: 'US',
        },
        properties,
      },
    });
  };
  track('page_viewed', { page_type: plan.landing });
  let last = null;
  for (let i = 0; i < plan.views; i++) {
    const product = pickProduct(client.products, persona, rand);
    if (!product) break;
    last = product;
    track('product_viewed', {
      product_id: product.id,
      category_path: product.categoryPath ?? '',
      price_cents: product.priceMinCents ?? 0,
      title: product.title,
      ...(product.brand ? { brand: product.brand } : {}),
    });
  }
  if (!plan.addToCart || !last) return out;
  const price = last.priceMinCents ?? 0;
  const variantId = uuidv7();
  track('cart_item_added', {
    product_id: last.id,
    variant_id: variantId,
    quantity: 1,
    price_cents: price,
    category_path: last.categoryPath ?? '',
    title: last.title,
  });
  if (!plan.checkout) return out;
  track('checkout_started', { cart_id: uuidv7(), value_cents: price, items_count: 1 });
  const orderId = uuidv7();
  const number = 100000 + Math.floor(rand() * 900000);
  const placedAt = tick();
  out.push({
    exchange: EXCHANGES.track,
    routingKey: 'order.placed',
    body: {
      event_id: uuidv7(),
      event_type: 'order.placed',
      schema_version: 1,
      tenant_id: info.id,
      occurred_at: placedAt,
      properties: {
        order_id: orderId,
        number,
        customer_id: null,
        profile_id: visitorId,
        items: [
          {
            product_id: last.id,
            variant_id: variantId,
            qty: 1,
            unit_price_cents: price,
            category_path: last.categoryPath ?? '',
            title: last.title,
          },
        ],
        total_cents: price,
        currency: info.currency,
        attribution: null,
      },
    },
  });
  if (plan.purchase)
    out.push({
      exchange: EXCHANGES.track,
      routingKey: 'order.paid',
      body: {
        event_id: uuidv7(),
        event_type: 'order.paid',
        schema_version: 1,
        tenant_id: info.id,
        occurred_at: tick(),
        properties: { order_id: orderId, amount_cents: price, number },
      },
    });
  return out;
}

export async function runBackfill(
  client: StoreClient,
  personas: Persona[],
  options: BackfillOptions,
): Promise<{ sessions: number; events: number }> {
  const amqp = new AmqpClient({
    url: options.rabbitUrl,
    name: 'simulator-backfill',
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const publisher = new Publisher(amqp);
  await amqp.start();
  for (let i = 0; i < 50 && !publisher.ready; i++) await new Promise((r) => setTimeout(r, 100));
  const now = options.now ?? Date.now();
  const visitors = new Map<string, string[]>();
  let sessions = 0;
  let events = 0;
  try {
    for (let day = options.days; day >= 1; day--) {
      const dayStart = now - day * 86_400_000;
      const weekday = new Date(dayStart).getUTCDay();
      const volume = Math.round(
        options.sessionsPerDay * (weekday === 0 || weekday === 6 ? 1.3 : 1) * (0.85 + options.rand() * 0.3),
      );
      const messages: Message[] = [];
      for (let s = 0; s < volume; s++) {
        const persona = pickPersona(personas, options.rand);
        const pool = visitors.get(persona.key) ?? [];
        visitors.set(persona.key, pool);
        const visitor =
          pool.length > 0 && options.rand() < persona.return_rate
            ? pool[Math.floor(options.rand() * pool.length)]!
            : uuidv7();
        if (!pool.includes(visitor)) pool.push(visitor);
        if (pool.length > 3000) pool.shift();
        const start = dayStart + Math.floor(options.rand() * 86_000_000);
        messages.push(...backfillSession(client, persona, options.rand, start, visitor));
        sessions += 1;
      }
      for (let i = 0; i < messages.length; i += 500) {
        await Promise.all(
          messages.slice(i, i + 500).map((m) =>
            publisher.publish({
              exchange: m.exchange,
              routingKey: m.routingKey,
              body: m.body,
              messageId: String(m.body.event_id),
              headers: {
                [MESSAGE_HEADERS.tenantId]: String(m.body.tenant_id),
                [MESSAGE_HEADERS.eventType]: m.routingKey,
                [MESSAGE_HEADERS.schemaVersion]: 1,
                [MESSAGE_HEADERS.retryCount]: 0,
                'x-backfill': 1,
              },
            }),
          ),
        );
      }
      events += messages.length;
      options.logger?.info({ day, sessions, events }, 'backfill progress');
    }
  } finally {
    await amqp.close();
  }
  return { sessions, events };
}
