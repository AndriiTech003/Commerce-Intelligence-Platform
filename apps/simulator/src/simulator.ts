import { redisKeys, uuidv7, type RedisKeys } from '@cip/contracts';
import { createLogger, gauge, initMetrics, startOpsServer, type Logger } from '@cip/observability';
import { seededRandom } from '@cip/personalization';
import { Redis } from 'ioredis';
import type { Server } from 'node:http';
import { pickPersona, type ArmTruth, type Random } from './behaviour';
import { StoreClient, type DecisionResponse, type Visitor } from './client';
import type { SimulatorConfig } from './config';
import { loadPersonas, type Persona } from './personas';
import { Recorder } from './recorder';
import { SessionRunner } from './session';

const inflightGauge = gauge('simulator_sessions_inflight', 'Sessions currently running');

export interface EngineOptions {
  apiUrl: string;
  collectorUrl: string;
  store: string;
  personas: Persona[];
  rand: Random;
  pageDelayMs: [number, number];
  maxConcurrency: number;
  redis: Redis | null;
  keys: RedisKeys;
  logger?: Logger;
}

export class SimulationEngine {
  readonly client: StoreClient;
  readonly recorder: Recorder;
  private readonly runner: SessionRunner;
  private readonly visitors = new Map<string, Visitor[]>();
  private readonly armCache = new Map<string, { arms: ArmTruth[]; expires: number }>();
  private inflight = 0;
  private carry = 0;
  shifted: Record<string, Record<string, number>> = {};
  shares: Record<string, number> = {};

  constructor(private readonly options: EngineOptions) {
    this.client = new StoreClient(options.apiUrl, options.collectorUrl, options.store);
    this.runner = new SessionRunner(this.client);
    this.recorder = new Recorder(
      options.redis,
      options.keys,
      options.personas,
      () => this.shifted,
      () => this.client.info?.id ?? null,
    );
  }

  get active(): number {
    return this.inflight;
  }

  async init(): Promise<boolean> {
    return this.client.load();
  }

  private visitor(persona: Persona): Visitor {
    const pool = this.visitors.get(persona.key) ?? [];
    this.visitors.set(persona.key, pool);
    if (pool.length > 0 && this.options.rand() < persona.return_rate)
      return pool[Math.floor(this.options.rand() * pool.length)]!;
    const visitor: Visitor = {
      anonymousId: uuidv7(),
      personaKey: persona.key,
      customerId: null,
      token: null,
      email: null,
      sessions: 0,
    };
    pool.push(visitor);
    if (pool.length > 2000) pool.splice(0, pool.length - 2000);
    return visitor;
  }

  private async arms(decision: DecisionResponse, visitor: Visitor): Promise<ArmTruth[]> {
    const hit = this.armCache.get(decision.campaignId);
    if (hit && hit.expires > Date.now()) return hit.arms;
    const arms = (await this.client.explanation(visitor, decision.decisionId)).map((a) => ({
      creativeId: a.id,
      tone: a.tone,
    }));
    if (arms.length > 0) this.armCache.set(decision.campaignId, { arms, expires: Date.now() + 60_000 });
    return arms;
  }

  startSession(): Promise<void> | null {
    if (this.inflight >= this.options.maxConcurrency) return null;
    const persona = pickPersona(this.options.personas, this.options.rand, this.shares);
    const visitor = this.visitor(persona);
    this.inflight += 1;
    inflightGauge.set(this.inflight);
    return this.runner
      .run(visitor, persona, {
        rand: this.options.rand,
        delay: (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()),
        pageDelayMs: this.options.pageDelayMs,
        shifted: this.shifted,
        arms: (d, v) => this.arms(d, v),
        observer: this.recorder,
      })
      .catch((error: unknown) => {
        this.recorder.error();
        this.options.logger?.debug({ err: error }, 'session failed');
      })
      .finally(() => {
        this.inflight -= 1;
        inflightGauge.set(this.inflight);
      });
  }

  tick(rate: number): number {
    this.carry += rate;
    let started = 0;
    while (this.carry >= 1) {
      this.carry -= 1;
      if (this.startSession()) started += 1;
    }
    return started;
  }
}

export async function runForDuration(
  engine: SimulationEngine,
  rate: number,
  seconds: number,
  onTick?: () => Promise<void>,
): Promise<void> {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const started = Date.now();
    engine.tick(rate / 4);
    await new Promise((r) => setTimeout(r, Math.max(0, 250 - (Date.now() - started))));
    if (onTick) await onTick();
  }
  while (engine.active > 0) await new Promise((r) => setTimeout(r, 100));
}

export interface RunningSimulator {
  logger: Logger;
  stop(): Promise<void>;
}

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function startSimulator(config: SimulatorConfig): Promise<RunningSimulator> {
  initMetrics('simulator');
  const logger = createLogger('simulator', { level: config.LOG_LEVEL });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  const keys = redisKeys(config.REDIS_PREFIX);
  const personas = loadPersonas();
  const rand = seededRandom(config.SIM_SEED);
  const engines = new Map<string, SimulationEngine>();
  const stores = config.SIM_STORES.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let busy = false;
  let lastFlush = 0;
  const loop = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      const state = await redis.hgetall(keys.simState());
      const shifted = parseJson<Record<string, Record<string, number>>>(await redis.get(keys.simShift()), {});
      for (const engine of engines.values()) engine.shifted = shifted;
      if (state.running !== '1') return;
      const rate = Math.max(0.1, Number(state.rate ?? 2));
      const shares = parseJson<Record<string, number>>(state.personas, {});
      for (const slug of stores) {
        let engine = engines.get(slug);
        if (!engine) {
          engine = new SimulationEngine({
            apiUrl: config.API_URL,
            collectorUrl: config.COLLECTOR_URL,
            store: slug,
            personas,
            rand,
            pageDelayMs: [config.SIM_PAGE_DELAY_MIN_MS, config.SIM_PAGE_DELAY_MAX_MS],
            maxConcurrency: config.SIM_MAX_CONCURRENCY,
            redis,
            keys,
            logger,
          });
          if (!(await engine.init())) continue;
          engines.set(slug, engine);
        }
        engine.shares = Object.keys(shares).length > 0 ? shares : {};
        engine.shifted = shifted;
        engine.tick(rate / stores.length / 4);
      }
      if (Date.now() - lastFlush > 3000) {
        lastFlush = Date.now();
        for (const engine of engines.values()) await engine.recorder.flush();
      }
    })()
      .catch((error: unknown) => logger.warn({ err: error }, 'simulation tick failed'))
      .finally(() => {
        busy = false;
      });
  }, 250);
  const server: Server = await startOpsServer({
    port: config.SIMULATOR_PORT,
    ready: {
      redis: async () => {
        await redis.ping();
      },
    },
  });
  logger.info({ port: config.SIMULATOR_PORT, personas: personas.map((p) => p.key) }, 'simulator started');
  return {
    logger,
    stop: async () => {
      clearInterval(loop);
      for (const engine of engines.values()) await engine.recorder.flush().catch(() => undefined);
      redis.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
