import type { RedisKeys } from '@cip/contracts';
import type { Redis } from 'ioredis';
import { effectiveMultipliers, regretStep } from './behaviour';
import type { DecisionResponse } from './client';
import type { Persona } from './personas';
import type { SessionObserver } from './session';

interface PersonaStats {
  sessions: number;
  segments: Record<string, number>;
  impressions: number;
  clicks: number;
}

interface RegretState {
  thompson: number;
  uniform: number;
  decisions: number;
  series: Array<{ t: number; thompson: number; uniform: number }>;
}

export class Recorder implements SessionObserver {
  private readonly personas = new Map<string, PersonaStats>();
  private readonly regret = new Map<string, RegretState>();
  private readonly stats = { sessions: 0, decisions: 0, clicks: 0, orders: 0, errors: 0, holdout: 0 };
  private campaignId: string | null = null;
  private lastPoint = 0;

  constructor(
    private readonly redis: Redis | null,
    private readonly keys: RedisKeys,
    private readonly personaList: Persona[],
    private readonly shifted: () => Record<string, Record<string, number>>,
    private readonly tenantId: () => string | null,
  ) {}

  private persona(key: string): PersonaStats {
    let stats = this.personas.get(key);
    if (!stats) {
      stats = { sessions: 0, segments: {}, impressions: 0, clicks: 0 };
      this.personas.set(key, stats);
    }
    return stats;
  }

  session(persona: Persona): void {
    this.persona(persona.key).sessions += 1;
    this.stats.sessions += 1;
  }

  decision(
    persona: Persona,
    decision: DecisionResponse,
    clicked: boolean,
    probabilities: Record<string, number> | null,
    warm: boolean,
  ): void {
    const stats = this.persona(persona.key);
    stats.impressions += 1;
    if (clicked) stats.clicks += 1;
    this.stats.decisions += 1;
    if (clicked) this.stats.clicks += 1;
    if (decision.policy === 'holdout_uniform') {
      this.stats.holdout += 1;
      return;
    }
    if (warm) stats.segments[decision.segmentKey] = (stats.segments[decision.segmentKey] ?? 0) + 1;
    if (decision.placement === 'home_hero') this.campaignId = decision.campaignId;
    if (!probabilities) return;
    const state = this.regret.get(decision.campaignId) ?? {
      thompson: 0,
      uniform: 0,
      decisions: 0,
      series: [],
    };
    const step = regretStep(probabilities, decision.creativeId);
    state.thompson += step.thompson;
    state.uniform += step.uniform;
    state.decisions += 1;
    this.regret.set(decision.campaignId, state);
  }

  order(ok: boolean): void {
    if (ok) this.stats.orders += 1;
  }

  error(): void {
    this.stats.errors += 1;
  }

  snapshot() {
    return {
      stats: { ...this.stats },
      personas: Object.fromEntries(this.personas),
      regret: Object.fromEntries(
        [...this.regret].map(([k, v]) => [
          k,
          { thompson: v.thompson, uniform: v.uniform, decisions: v.decisions },
        ]),
      ),
    };
  }

  async flush(now = Date.now()): Promise<void> {
    if (!this.redis) return;
    const pipeline = this.redis.pipeline();
    const shifted = this.shifted();
    for (const persona of this.personaList) {
      const stats = this.persona(persona.key);
      pipeline.hset(
        this.keys.simTruth(),
        `persona:${persona.key}`,
        JSON.stringify({ ...stats, toneMultipliers: effectiveMultipliers(persona, shifted) }),
      );
    }
    if (this.campaignId) pipeline.hset(this.keys.simTruth(), 'campaign', this.campaignId);
    const tenant = this.tenantId();
    if (tenant) pipeline.hset(this.keys.simTruth(), 'tenant', tenant);
    pipeline.expire(this.keys.simTruth(), 7 * 86400);
    const addPoint = now - this.lastPoint >= 10_000;
    if (addPoint) this.lastPoint = now;
    for (const [campaignId, state] of this.regret) {
      if (addPoint) {
        state.series.push({
          t: now,
          thompson: Math.round(state.thompson * 1000) / 1000,
          uniform: Math.round(state.uniform * 1000) / 1000,
        });
        if (state.series.length > 720) state.series.splice(0, state.series.length - 720);
      }
      pipeline.hset(this.keys.simRegret(), campaignId, JSON.stringify(state));
    }
    pipeline.expire(this.keys.simRegret(), 7 * 86400);
    for (const [key, value] of Object.entries(this.stats))
      pipeline.hset(this.keys.simState(), `stat:${key}`, String(value));
    await pipeline.exec();
  }

  async reset(): Promise<void> {
    this.personas.clear();
    this.regret.clear();
    if (this.redis) await this.redis.del(this.keys.simTruth(), this.keys.simRegret());
  }
}
