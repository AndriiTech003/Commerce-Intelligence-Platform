import { redisKeys } from '@cip/contracts';
import { createLogger, initMetrics, onShutdown } from '@cip/observability';
import { seededRandom } from '@cip/personalization';
import { Redis } from 'ioredis';
import { runBackfill } from './backfill';
import { loadConfig } from './config';
import { loadPersonas } from './personas';
import { runForDuration, SimulationEngine, startSimulator } from './simulator';

const config = loadConfig();
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : args.includes('--once') ? 'once' : 'live';
const flag = (name: string, fallback?: string) => {
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1]!.startsWith('--') ? args[index + 1] : fallback;
};

if (command === 'live') {
  const simulator = await startSimulator(config);
  onShutdown(simulator.logger, () => simulator.stop());
} else {
  initMetrics('simulator');
  const logger = createLogger('simulator', { level: config.LOG_LEVEL });
  const personas = loadPersonas();
  const store = flag('store', config.SIM_STORES.split(',')[0] ?? 'runhub')!;
  const rand = seededRandom(Number(flag('seed', String(config.SIM_SEED))));
  const redis =
    command === 'run' || command === 'shift'
      ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 })
      : null;
  const keys = redisKeys(config.REDIS_PREFIX);
  const engine = new SimulationEngine({
    apiUrl: config.API_URL,
    collectorUrl: config.COLLECTOR_URL,
    store,
    personas,
    rand,
    pageDelayMs: command === 'load' ? [0, 0] : [config.SIM_PAGE_DELAY_MIN_MS, config.SIM_PAGE_DELAY_MAX_MS],
    maxConcurrency: Number(flag('concurrency', String(config.SIM_MAX_CONCURRENCY))),
    redis,
    keys,
    logger,
  });
  if (command === 'shift') {
    const persona = flag('persona');
    const tones = flag('tones', '')!;
    if (!persona || !tones) {
      console.error('usage: shift --persona gift_buyer --tones performance:2,premium:0.5');
      process.exit(1);
    }
    const current = JSON.parse((await redis!.get(keys.simShift())) ?? '{}') as Record<
      string,
      Record<string, number>
    >;
    current[persona] = Object.fromEntries(
      tones
        .split(',')
        .map((p) => p.split(':'))
        .map(([k, v]) => [k!, Number(v)]),
    );
    await redis!.set(keys.simShift(), JSON.stringify(current));
    console.log(`simulator: shifted ${persona} to ${JSON.stringify(current[persona])}`);
    redis!.disconnect();
    process.exit(0);
  }
  if (!(await engine.init())) {
    console.error(`store ${store} not found or has no tracking key`);
    process.exit(1);
  }
  const started = Date.now();
  if (command === 'backfill') {
    const result = await runBackfill(engine.client, personas, {
      days: Number(flag('days', '90')),
      sessionsPerDay: Number(flag('sessions-per-day', '200')),
      rabbitUrl: config.RABBITMQ_URL,
      rand,
      logger,
    });
    console.log(
      `simulator: backfilled ${result.sessions} sessions / ${result.events} events in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  } else if (command === 'once') {
    const sessions = Number(flag('sessions', '10'));
    for (let i = 0; i < sessions; i++) await engine.startSession();
    console.log(
      `simulator: ran ${sessions} sessions on ${store}: ${JSON.stringify(engine.recorder.snapshot().stats)}`,
    );
  } else if (command === 'run' || command === 'load') {
    const rate = Number(flag('rate', command === 'load' ? '1000' : '10'));
    const duration = Number(flag('duration', '60'));
    let last = 0;
    await runForDuration(engine, rate, duration, async () => {
      if (redis && Date.now() - last > 3000) {
        last = Date.now();
        await engine.recorder.flush();
      }
    });
    await engine.recorder.flush();
    const elapsed = (Date.now() - started) / 1000;
    const snapshot = engine.recorder.snapshot();
    console.log(
      JSON.stringify(
        {
          mode: command,
          store,
          elapsedSeconds: elapsed,
          sessionsPerSecond: snapshot.stats.sessions / elapsed,
          ...snapshot,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(`unknown command ${command}; use live | once | run | load | backfill | shift`);
    process.exit(1);
  }
  redis?.disconnect();
  process.exit(0);
}
