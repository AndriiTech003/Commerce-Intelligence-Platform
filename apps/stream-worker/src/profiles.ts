import type { RedisKeys } from '@cip/contracts';
import type { BatchItem } from '@cip/messaging';
import { counter, histogram } from '@cip/observability';
import {
  ALIAS_TTL_SECONDS,
  HALF_LIFE_MS,
  PROFILE_MERGE_LUA,
  PROFILE_TTL_SECONDS,
  PROFILE_UPDATE_LUA,
  type ProfileEvent,
} from '@cip/personalization';
import type { Redis } from 'ioredis';
import type { PipelineEvent } from './mapping';

const applied = counter('profile_events_applied_total', 'Profile events applied by the Lua script', ['kind']);
const merges = counter('profile_merges_total', 'Anonymous profiles merged into customers');
const luaSeconds = histogram('profile_update_seconds', 'Profile Lua update duration per profile batch');

export type ProfileWork =
  | { type: 'update'; tenantId: string; profileId: string; event: ProfileEvent }
  | { type: 'merge'; tenantId: string; customerId: string; anonymousId: string };

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function toProfileWork(item: PipelineEvent): ProfileWork | null {
  if (item.kind === 'domain') {
    const e = item.event;
    const t = Date.parse(e.occurred_at);
    if (e.event_type === 'customer.identified') {
      return {
        type: 'merge',
        tenantId: e.tenant_id,
        customerId: e.properties.customer_id,
        anonymousId: e.properties.anonymous_id,
      };
    }
    if (e.event_type === 'order.placed') {
      const p = e.properties;
      return {
        type: 'update',
        tenantId: e.tenant_id,
        profileId: p.profile_id,
        event: compact({
          id: e.event_id,
          k: 'purchase' as const,
          t,
          cid: p.customer_id ?? undefined,
          amount: p.total_cents,
          discount: Boolean(p.discount_code) || (p.discount_cents ?? 0) > 0,
          items: p.items.map((i) =>
            compact({
              pid: i.product_id,
              cat: i.category_path || undefined,
              price: i.unit_price_cents,
              qty: i.qty,
            }),
          ),
        }),
      };
    }
    if (e.event_type === 'order.refunded' && e.properties.profile_id) {
      return {
        type: 'update',
        tenantId: e.tenant_id,
        profileId: e.properties.profile_id,
        event: { id: e.event_id, k: 'refund', t, amount: e.properties.amount_cents },
      };
    }
    return null;
  }
  const e = item.event;
  const profileId = e.customer_id ?? e.anonymous_id;
  if (!profileId) return null;
  const p = e.properties as Record<string, unknown>;
  const base = {
    id: e.event_id,
    t: Date.parse(e.occurred_at),
    sid: e.session_id,
    cid: e.customer_id,
  };
  let event: ProfileEvent | null;
  switch (e.event_type) {
    case 'product_viewed':
      event = {
        ...base,
        k: 'view',
        pid: str(p.product_id),
        cat: str(p.category_path),
        brand: str(p.brand),
        price: num(p.price_cents),
      };
      break;
    case 'search_performed':
      event = { ...base, k: 'search', cat: str(p.category_path) };
      break;
    case 'ad_clicked':
      event = { ...base, k: 'ad_click', tone: str(p.tone), cat: str(p.category_path) };
      break;
    case 'cart_item_added':
      event = {
        ...base,
        k: 'add_to_cart',
        pid: str(p.product_id),
        cat: str(p.category_path),
        brand: str(p.brand),
        price: num(p.price_cents),
      };
      break;
    case 'cart_item_removed':
      event = {
        ...base,
        k: 'remove_from_cart',
        pid: str(p.product_id),
        cat: str(p.category_path),
        brand: str(p.brand),
      };
      break;
    case 'checkout_started':
      event = { ...base, k: 'checkout' };
      break;
    default:
      event = null;
  }
  return event ? { type: 'update', tenantId: e.tenant_id, profileId, event: compact(event) } : null;
}

export class ProfileUpdater {
  constructor(
    private readonly redis: Redis,
    private readonly keys: RedisKeys,
    private readonly options: { halfLifeMs?: number; dedupTtlSeconds?: number } = {},
  ) {}

  async applyUpdates(tenantId: string, profileId: string, events: ProfileEvent[]): Promise<number> {
    const timer = luaSeconds.startTimer();
    const result = await this.redis.eval(
      PROFILE_UPDATE_LUA,
      3,
      this.keys.profile(tenantId, profileId),
      this.keys.profileDirty(tenantId),
      this.keys.profileDirtyTenants(),
      JSON.stringify(events),
      String(this.options.halfLifeMs ?? HALF_LIFE_MS),
      String(PROFILE_TTL_SECONDS),
      this.keys.profileDedupPrefix(),
      this.keys.profilePrefix(tenantId),
      profileId,
      tenantId,
      String(Date.now()),
      String(this.options.dedupTtlSeconds ?? 48 * 3600),
    );
    timer();
    return Number(result ?? 0);
  }

  async merge(tenantId: string, anonymousId: string, customerId: string): Promise<number> {
    const result = await this.redis.eval(
      PROFILE_MERGE_LUA,
      4,
      this.keys.profile(tenantId, anonymousId),
      this.keys.profile(tenantId, customerId),
      this.keys.profileDirty(tenantId),
      this.keys.profileDirtyTenants(),
      String(this.options.halfLifeMs ?? HALF_LIFE_MS),
      String(PROFILE_TTL_SECONDS),
      String(ALIAS_TTL_SECONDS),
      customerId,
      tenantId,
    );
    return Number(result ?? 0);
  }

  async handleBatch(items: BatchItem<PipelineEvent>[]): Promise<void> {
    const groups = new Map<string, { tenantId: string; profileId: string; events: ProfileEvent[] }>();
    const mergeWork: Array<{ tenantId: string; customerId: string; anonymousId: string }> = [];
    for (const item of items) {
      const work = toProfileWork(item.data);
      if (!work) continue;
      if (work.type === 'merge') {
        mergeWork.push(work);
        continue;
      }
      if (!Number.isFinite(work.event.t)) continue;
      const key = `${work.tenantId}:${work.profileId}`;
      const group = groups.get(key) ?? { tenantId: work.tenantId, profileId: work.profileId, events: [] };
      group.events.push(work.event);
      groups.set(key, group);
    }
    await Promise.all(
      [...groups.values()].map(async (group) => {
        const count = await this.applyUpdates(group.tenantId, group.profileId, group.events);
        if (count > 0) for (const e of group.events) applied.inc({ kind: e.k });
      }),
    );
    for (const work of mergeWork) {
      await this.merge(work.tenantId, work.anonymousId, work.customerId);
      merges.inc();
    }
  }
}
