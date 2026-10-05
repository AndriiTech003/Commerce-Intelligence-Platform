import geoip from 'geoip-lite';
import UAParser from 'ua-parser-js';
import { normalizeOccurredAt, type IncomingTrackEvent } from '@cip/contracts';

export type Device = 'desktop' | 'mobile' | 'tablet';

export function deviceFromUserAgent(ua: string | undefined): Device {
  if (!ua) return 'desktop';
  const type = new UAParser(ua).getDevice().type;
  if (type === 'mobile' || type === 'wearable') return 'mobile';
  if (type === 'tablet' || /iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function countryFromIp(ip: string | undefined | null): string | undefined {
  if (!ip) return undefined;
  const clean = ip.replace(/^::ffff:/, '');
  const hit = geoip.lookup(clean);
  return hit?.country || undefined;
}

export interface EnrichContext {
  tenantId: string;
  ip: string | null;
  userAgent: string | undefined;
  receivedAt: string;
}

export function enrich(event: IncomingTrackEvent, ctx: EnrichContext): Record<string, unknown> {
  const { occurred_at, clock_skew } = normalizeOccurredAt(event.occurred_at, ctx.receivedAt);
  const context = { ...(event.context ?? {}) } as Record<string, unknown>;
  const ua = typeof context.user_agent === 'string' ? context.user_agent : ctx.userAgent;
  if (ua) context.user_agent = ua.slice(0, 1024);
  context.device = deviceFromUserAgent(ua);
  const country = countryFromIp(ctx.ip);
  if (country) context.country = country;
  else delete context.country;
  return {
    ...event,
    tenant_id: ctx.tenantId,
    received_at: ctx.receivedAt,
    occurred_at,
    context,
    properties: clock_skew ? { ...event.properties, clock_skew: true } : event.properties,
  };
}
