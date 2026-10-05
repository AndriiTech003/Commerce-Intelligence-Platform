import { Inject, Injectable } from '@nestjs/common';
import type { RedisKeys } from '@cip/contracts';
import { probabilityBest } from '@cip/personalization';
import type { Redis } from 'ioredis';
import { KEYS, REDIS } from '../../../shared/tokens';
import {
  BANDIT_STORE,
  CAMPAIGN_REPOSITORY,
  type BanditStore,
  type CampaignRepository,
} from '../../campaigns';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  bestTone,
  DEFAULT_SIMULATOR_STATE,
  majoritySegment,
  type PersonaTruth,
  type SimulatorState,
} from '../domain/simulator';

function json<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

@Injectable()
export class SimulatorControlService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(BANDIT_STORE) private readonly bandit: BanditStore,
    @Inject(CAMPAIGN_REPOSITORY) private readonly campaigns: CampaignRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async state(): Promise<SimulatorState> {
    const raw = await this.redis.hgetall(this.keys.simState());
    const shifted = json<Record<string, Record<string, number>>>(
      (await this.redis.get(this.keys.simShift())) ?? undefined,
      {},
    );
    const stats = Object.fromEntries(
      Object.entries(raw)
        .filter(([k]) => k.startsWith('stat:'))
        .map(([k, v]) => [k.slice(5), Number(v)]),
    );
    if (!raw.running) return { ...DEFAULT_SIMULATOR_STATE, shifted, stats };
    return {
      running: raw.running === '1',
      rate: Number(raw.rate ?? DEFAULT_SIMULATOR_STATE.rate),
      personas: json(raw.personas, {}),
      shifted,
      mode: raw.mode ?? 'live',
      updatedAt: raw.updatedAt ?? null,
      stats,
    };
  }

  async apply(input: {
    action: 'start' | 'stop' | 'shift' | 'reset_shift';
    rate?: number | undefined;
    personas?: Record<string, number> | undefined;
    shift?: { persona: string; toneMultipliers: Record<string, number> } | undefined;
  }) {
    const current = await this.state();
    if (input.action === 'shift' && input.shift) {
      const shifted = { ...current.shifted, [input.shift.persona]: input.shift.toneMultipliers };
      await this.redis.set(this.keys.simShift(), JSON.stringify(shifted));
    }
    if (input.action === 'reset_shift') await this.redis.del(this.keys.simShift());
    const running = input.action === 'start' ? true : input.action === 'stop' ? false : current.running;
    await this.redis.hset(this.keys.simState(), {
      running: running ? '1' : '0',
      rate: String(input.rate ?? current.rate),
      personas: JSON.stringify(input.personas ?? current.personas),
      mode: 'live',
      updatedAt: new Date().toISOString(),
    });
    return this.state();
  }

  async groundTruth() {
    const raw = await this.redis.hgetall(this.keys.simTruth());
    const campaignId = raw.campaign ?? null;
    const tenantId = raw.tenant ?? null;
    const personas = Object.entries(raw)
      .filter(([k]) => k.startsWith('persona:'))
      .map(([k, v]) => ({ persona: k.slice(8), truth: json<PersonaTruth | null>(v, null) }))
      .filter((p): p is { persona: string; truth: PersonaTruth } => p.truth !== null);
    let campaignName: string | null = null;
    let creatives: Array<{ id: string; tone: string | null }> = [];
    if (campaignId && tenantId) {
      const loaded = await this.uow.runForTenant(tenantId, async () => ({
        campaign: await this.campaigns.find(campaignId),
        creatives: await this.campaigns.creatives(campaignId),
      }));
      campaignName = loaded.campaign?.name ?? null;
      creatives = loaded.creatives.filter((c) => ['active', 'paused', 'approved'].includes(c.status));
    }
    const rows = [];
    for (const { persona, truth } of personas.sort((a, b) => a.persona.localeCompare(b.persona))) {
      const majority = majoritySegment(truth.segments);
      let learnedTone: string | null = null;
      let pBest: number | null = null;
      let impressions = 0;
      if (campaignId && majority.key && creatives.length > 0) {
        const arms = await this.bandit.arms(
          campaignId,
          majority.key,
          creatives.map((c) => c.id),
        );
        impressions = arms.reduce((s, a) => s + a.impressions, 0);
        const probabilities = probabilityBest(
          arms.map((a) => ({ alpha: a.alpha, beta: a.beta })),
          10000,
        );
        const best = probabilities.indexOf(Math.max(...probabilities));
        if (best >= 0 && impressions > 0) {
          learnedTone = creatives.find((c) => c.id === arms[best]!.creativeId)?.tone ?? null;
          pBest = probabilities[best] ?? null;
        }
      }
      const trueBestTone = bestTone(truth.toneMultipliers);
      rows.push({
        persona,
        trueBestTone,
        toneMultipliers: truth.toneMultipliers,
        sessions: truth.sessions,
        segmentKey: majority.key,
        segmentShare: Math.round(majority.share * 1000) / 1000,
        learnedTone,
        pBest,
        impressions,
        correct: learnedTone === trueBestTone,
      });
    }
    const regretRaw = campaignId ? await this.redis.hget(this.keys.simRegret(), campaignId) : null;
    const regret = regretRaw
      ? json<{ thompson: number; uniform: number; decisions: number } | null>(regretRaw, null)
      : null;
    return {
      campaignId,
      campaignName,
      rows,
      regret: regret
        ? { thompson: regret.thompson, uniform: regret.uniform, decisions: regret.decisions }
        : null,
    };
  }
}
