import type { RedisKeys } from '@cip/contracts';
import { counter } from '@cip/observability';
import type { Redis } from 'ioredis';
import type { PipelineEvent } from './mapping';

const pairs = counter('reco_cooccurrence_pairs_total', 'Co-occurrence pair increments', ['source']);

export const COOC_TTL_SECONDS = 7 * 86400;
export const SESSION_TTL_SECONDS = 1800;
export const COOC_HALF_LIFE_MS = 7 * 86_400_000;
const EPOCH = Date.UTC(2026, 0, 1);

export function timeWeight(weight: number, occurredAt: number, halfLifeMs = COOC_HALF_LIFE_MS): number {
  return weight * Math.pow(2, (occurredAt - EPOCH) / halfLifeMs);
}

export class CooccurrenceUpdater {
  constructor(
    private readonly redis: Redis,
    private readonly keys: RedisKeys,
  ) {}

  async apply(item: PipelineEvent): Promise<void> {
    if (item.kind === 'track' && item.event.event_type === 'product_viewed') {
      const e = item.event;
      const productId = (e.properties as { product_id?: string }).product_id;
      const session = e.session_id ?? e.anonymous_id;
      if (!productId || !session) return;
      const sessionKey = this.keys.recoSession(e.tenant_id, session);
      const previous = (await this.redis.lrange(sessionKey, 0, 9)).filter((p) => p !== productId);
      const inc = timeWeight(1, Date.parse(e.occurred_at));
      const pipeline = this.redis.pipeline();
      pipeline.lrem(sessionKey, 0, productId);
      pipeline.lpush(sessionKey, productId);
      pipeline.ltrim(sessionKey, 0, 9);
      pipeline.expire(sessionKey, SESSION_TTL_SECONDS);
      for (const other of new Set(previous)) {
        this.pair(pipeline, e.tenant_id, productId, other, inc);
        pairs.inc({ source: 'view' });
      }
      await pipeline.exec();
      return;
    }
    if (item.kind === 'domain' && item.event.event_type === 'order.placed') {
      const e = item.event;
      const ids = [...new Set(e.properties.items.map((i) => i.product_id))];
      if (ids.length < 2) return;
      const inc = timeWeight(5, Date.parse(e.occurred_at));
      const pipeline = this.redis.pipeline();
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          this.pair(pipeline, e.tenant_id, ids[i]!, ids[j]!, inc);
          pairs.inc({ source: 'order' });
        }
      await pipeline.exec();
    }
  }

  private pair(pipeline: ReturnType<Redis['pipeline']>, tenantId: string, a: string, b: string, inc: number) {
    const ka = this.keys.recoCooc(tenantId, a);
    const kb = this.keys.recoCooc(tenantId, b);
    pipeline.zincrby(ka, inc, b);
    pipeline.zincrby(kb, inc, a);
    pipeline.expire(ka, COOC_TTL_SECONDS);
    pipeline.expire(kb, COOC_TTL_SECONDS);
  }
}
