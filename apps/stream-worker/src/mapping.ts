import { createHash } from 'node:crypto';
import {
  ANALYTICS_EVENTS,
  isDomainEventType,
  parseDomainEvent,
  parseTrackEvent,
  type DomainEvent,
  type TrackEvent,
} from '@cip/contracts';
import { PoisonMessageError } from '@cip/messaging';

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export type PipelineEvent = { kind: 'track'; event: TrackEvent } | { kind: 'domain'; event: DomainEvent };

export function parsePipelineEvent(raw: unknown): PipelineEvent {
  const type = (raw as { event_type?: unknown })?.event_type;
  if (typeof type === 'string' && isDomainEventType(type)) {
    const parsed = parseDomainEvent(raw);
    if (!parsed.ok) throw new PoisonMessageError(parsed.reason);
    return { kind: 'domain', event: parsed.event };
  }
  const parsed = parseTrackEvent(raw);
  if (!parsed.ok) throw new PoisonMessageError(parsed.reason);
  return { kind: 'track', event: parsed.event };
}

export interface EventRow {
  event_id: string;
  tenant_id: string;
  event_type: string;
  occurred_at: string;
  received_at: string;
  profile_id: string;
  anonymous_id: string;
  customer_id: string | null;
  session_id: string;
  product_id: string | null;
  variant_id: string | null;
  category_path: string;
  price_cents: number | null;
  quantity: number | null;
  order_id: string | null;
  revenue_cents: number | null;
  decision_id: string | null;
  campaign_id: string | null;
  creative_id: string | null;
  segment_key: string;
  country: string;
  device: string;
  properties: string;
}

export function chDateTime(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').replace('Z', '');
}

export function derivedId(base: string, salt: string): string {
  const hex = createHash('sha1').update(`${base}:${salt}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function base(
  tenantId: string,
  eventId: string,
  eventType: string,
  occurredAt: string,
  receivedAt: string,
): EventRow {
  return {
    event_id: eventId,
    tenant_id: tenantId,
    event_type: eventType,
    occurred_at: chDateTime(occurredAt),
    received_at: chDateTime(receivedAt),
    profile_id: ZERO_UUID,
    anonymous_id: ZERO_UUID,
    customer_id: null,
    session_id: ZERO_UUID,
    product_id: null,
    variant_id: null,
    category_path: '',
    price_cents: null,
    quantity: null,
    order_id: null,
    revenue_cents: null,
    decision_id: null,
    campaign_id: null,
    creative_id: null,
    segment_key: '',
    country: '',
    device: '',
    properties: '{}',
  };
}

export function trackRows(event: TrackEvent): EventRow[] {
  const p = event.properties as Record<string, unknown>;
  const row = base(
    event.tenant_id,
    event.event_id,
    event.event_type,
    event.occurred_at,
    event.received_at ?? new Date().toISOString(),
  );
  row.anonymous_id = event.anonymous_id ?? ZERO_UUID;
  row.customer_id = event.customer_id ?? null;
  row.profile_id = event.customer_id ?? event.anonymous_id ?? ZERO_UUID;
  row.session_id = event.session_id ?? ZERO_UUID;
  row.product_id = str(p.product_id);
  row.variant_id = str(p.variant_id);
  row.category_path = str(p.category_path) ?? '';
  row.price_cents = num(p.price_cents) ?? num(p.value_cents);
  if (event.event_type === 'ad_converted') {
    row.order_id = str(p.order_id);
    row.revenue_cents = num(p.revenue_cents);
  }
  row.quantity = num(p.quantity);
  row.decision_id = str(p.decision_id);
  row.campaign_id = str(p.campaign_id);
  row.creative_id = str(p.creative_id);
  row.segment_key = str(p.segment_key) ?? '';
  row.country = event.context?.country ?? '';
  row.device = event.context?.device ?? '';
  row.properties = JSON.stringify({
    ...p,
    ...(event.context?.page ? { page: event.context.page.path } : {}),
  });
  return [row];
}

export function domainRows(event: DomainEvent, receivedAt = new Date().toISOString()): EventRow[] {
  const at = (type: string) => base(event.tenant_id, event.event_id, type, event.occurred_at, receivedAt);
  switch (event.event_type) {
    case 'order.placed': {
      const p = event.properties;
      const row = at(ANALYTICS_EVENTS.orderPlaced);
      row.profile_id = p.profile_id;
      row.customer_id = p.customer_id ?? null;
      row.anonymous_id = p.customer_id ? ZERO_UUID : p.profile_id;
      row.order_id = p.order_id;
      row.quantity = p.items.reduce((s, i) => s + i.qty, 0);
      row.properties = JSON.stringify({ number: p.number, total_cents: p.total_cents, currency: p.currency });
      const items = p.items.map((item, index) => {
        const r = at(ANALYTICS_EVENTS.purchaseItem);
        r.event_id = derivedId(event.event_id, `item:${index}`);
        r.profile_id = row.profile_id;
        r.customer_id = row.customer_id;
        r.anonymous_id = row.anonymous_id;
        r.order_id = p.order_id;
        r.product_id = item.product_id;
        r.variant_id = item.variant_id;
        r.category_path = item.category_path;
        r.price_cents = item.unit_price_cents;
        r.quantity = item.qty;
        r.revenue_cents = item.unit_price_cents * item.qty;
        r.properties = JSON.stringify({ title: item.title ?? null });
        return r;
      });
      return [row, ...items];
    }
    case 'order.paid': {
      const row = at(ANALYTICS_EVENTS.orderPaid);
      row.order_id = event.properties.order_id;
      row.revenue_cents = event.properties.amount_cents;
      row.properties = JSON.stringify({ number: event.properties.number ?? null });
      return [row];
    }
    case 'order.refunded': {
      const row = at(ANALYTICS_EVENTS.orderRefunded);
      row.order_id = event.properties.order_id;
      row.revenue_cents = -event.properties.amount_cents;
      return [row];
    }
    case 'order.cancelled': {
      const row = at(ANALYTICS_EVENTS.orderCancelled);
      row.order_id = event.properties.order_id;
      row.properties = JSON.stringify({ reason: event.properties.reason });
      return [row];
    }
    case 'order.fulfilled': {
      const row = at(ANALYTICS_EVENTS.orderFulfilled);
      row.order_id = event.properties.order_id;
      return [row];
    }
    default:
      return [];
  }
}

export function rowsFor(item: PipelineEvent): EventRow[] {
  return item.kind === 'track' ? trackRows(item.event) : domainRows(item.event);
}

const FLAGS: Record<string, string> = {};

export function flag(country: string | undefined | null): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return '';
  if (!FLAGS[country])
    FLAGS[country] = String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  return FLAGS[country]!;
}

export function feedLabel(item: PipelineEvent): string {
  if (item.kind === 'domain') {
    const e = item.event;
    if (e.event_type === 'order.paid') return `Order #${e.properties.number ?? ''} paid`.replace('# ', '');
    return e.event_type;
  }
  const e = item.event;
  const p = e.properties as Record<string, unknown>;
  const who = `Someone${e.context?.country ? ` from ${flag(e.context.country)} ${e.context.country}` : ''}`;
  const title = typeof p.title === 'string' ? p.title : 'a product';
  switch (e.event_type) {
    case 'product_viewed':
      return `${who} viewed ${title}`;
    case 'cart_item_added':
      return `${who} added ${title} to cart`;
    case 'cart_item_removed':
      return `${who} removed ${title} from cart`;
    case 'checkout_started':
      return `${who} started checkout`;
    case 'search_performed':
      return `${who} searched for “${String(p.query ?? '')}”`;
    case 'page_viewed':
      return `${who} opened the ${String(p.page_type ?? 'page')} page`;
    default:
      return `${who}: ${e.event_type}`;
  }
}
