import { Inject, Injectable } from '@nestjs/common';
import type { RedisKeys } from '@cip/contracts';
import {
  BANDIT_IMPRESSION_LUA,
  BANDIT_RESTORE_LUA,
  BANDIT_SUCCESS_LUA,
  parseBanditHash,
  type ArmState,
} from '@cip/personalization';
import type { Redis } from 'ioredis';
import type { ApiConfig } from '../../../config';
import { CONFIG, KEYS, REDIS } from '../../../shared/tokens';
import type { BanditStore } from '../application/ports';

const DEDUPE_TTL = 48 * 3600;

@Injectable()
export class RedisBanditStore implements BanditStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  async arms(campaignId: string, segmentKey: string, creativeIds: string[]): Promise<ArmState[]> {
    return parseBanditHash(await this.rawState(campaignId, segmentKey), creativeIds);
  }

  rawState(campaignId: string, segmentKey: string) {
    return this.redis.hgetall(this.keys.banditState(campaignId, segmentKey));
  }

  async segments(campaignId: string): Promise<string[]> {
    const prefix = this.keys.banditState(campaignId, '');
    const out = new Set<string>();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      for (const key of keys) out.add(key.slice(prefix.length));
    } while (cursor !== '0');
    return [...out].filter((s) => s && !s.includes(':'));
  }

  async restore(campaignId: string, segmentKey: string, arms: ArmState[]) {
    const args = arms.flatMap((a) => [
      `${a.creativeId}:a`,
      String(a.alpha),
      `${a.creativeId}:b`,
      String(a.beta),
      `${a.creativeId}:n`,
      String(a.impressions),
      `${a.creativeId}:s`,
      String(a.successes),
    ]);
    if (args.length === 0) return false;
    return (
      (await this.redis.eval(
        BANDIT_RESTORE_LUA,
        1,
        this.keys.banditState(campaignId, segmentKey),
        ...args,
      )) === 1
    );
  }

  async initArm(campaignId: string, segmentKey: string, creativeId: string) {
    const key = this.keys.banditState(campaignId, segmentKey);
    await this.redis.hsetnx(key, `${creativeId}:a`, '1');
    await this.redis.hsetnx(key, `${creativeId}:b`, '1');
  }

  async impression(campaignId: string, segmentKey: string, creativeId: string, decisionId: string) {
    const result = await this.redis.eval(
      BANDIT_IMPRESSION_LUA,
      2,
      this.keys.banditState(campaignId, segmentKey),
      this.keys.banditImpression(decisionId),
      creativeId,
      String(this.config.BANDIT_DISCOUNT),
      String(DEDUPE_TTL),
    );
    return result === 1;
  }

  async success(
    campaignId: string,
    segmentKey: string,
    creativeId: string,
    decisionId: string,
    dedupeKey: string,
  ) {
    const result = await this.redis.eval(
      BANDIT_SUCCESS_LUA,
      3,
      this.keys.banditState(campaignId, segmentKey),
      this.keys.banditImpression(decisionId),
      dedupeKey.startsWith('conv:')
        ? this.keys.banditConversion(dedupeKey.slice(5))
        : this.keys.banditClick(dedupeKey.replace(/^clk:/, '')),
      creativeId,
      String(this.config.BANDIT_DISCOUNT),
      String(DEDUPE_TTL),
    );
    return result === 1;
  }
}
