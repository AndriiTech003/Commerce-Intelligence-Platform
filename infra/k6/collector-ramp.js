import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Gauge } from 'k6/metrics';
import { COLLECTOR_URL, TREND_STATS, env, num, pageViewed, resolveContext, summarize, uuid } from './lib.js';

const BATCH = num('BATCH', 20);
const START_RATE = num('START_RATE', 10);
const MAX_RATE = num('MAX_RATE', 500);
const RAMP = env('RAMP', '2m');
const HOLD = env('HOLD', '30s');
const ABORT = env('ABORT_ON_FAIL', '1') === '1';

const accepted = new Counter('events_accepted');
const rejected = new Counter('events_rejected');
const limited = new Counter('rate_limited_429');
const unavailable = new Counter('unavailable_503');
const targetRate = new Gauge('target_batches_per_second');

function seconds(text) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text);
  if (!match) return 0;
  const factor = { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]];
  return Number(match[1]) * factor;
}

const rampSeconds = seconds(RAMP);

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: START_RATE,
      timeUnit: '1s',
      preAllocatedVUs: num('PRE_VUS', 50),
      maxVUs: num('MAX_VUS', 500),
      stages: [
        { target: MAX_RATE, duration: RAMP },
        { target: MAX_RATE, duration: HOLD },
      ],
    },
  },
  thresholds: {
    'http_req_duration{scenario:ramp}': [
      { threshold: 'p(95)<100', abortOnFail: ABORT, delayAbortEval: '10s' },
    ],
    'http_req_failed{scenario:ramp}': [{ threshold: 'rate==0', abortOnFail: ABORT, delayAbortEval: '10s' }],
  },
};

export function setup() {
  return { ...resolveContext(), runId: env('RUN_ID', uuid()) };
}

export default function (ctx) {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  const progress = rampSeconds > 0 ? Math.min(1, elapsed / rampSeconds) : 1;
  targetRate.add(START_RATE + (MAX_RATE - START_RATE) * progress);
  const anonymousId = uuid();
  const events = Array.from({ length: BATCH }, () => pageViewed(anonymousId, ctx.runId));
  const res = http.post(`${COLLECTOR_URL}/v1/events`, JSON.stringify({ events }), {
    headers: { 'content-type': 'application/json', 'x-api-key': ctx.trackingKey },
    tags: { name: 'POST /v1/events' },
  });
  if (res.status === 202) {
    const body = res.json();
    accepted.add(body.accepted);
    rejected.add(body.rejected.length);
  } else if (res.status === 429) limited.add(1);
  else if (res.status === 503) unavailable.add(1);
  check(res, { accepted: (r) => r.status === 202 });
}

export function handleSummary(data) {
  const durationSeconds = (data.state?.testRunDurationMs ?? 0) / 1000;
  const events = data.metrics.events_accepted?.values.count ?? 0;
  return summarize(
    'collector-ramp',
    data,
    {
      batchSize: BATCH,
      eventsPerSecondAvg: durationSeconds ? Math.round(events / durationSeconds) : 0,
      lastTargetBatchesPerSecond: data.metrics.target_batches_per_second?.values.value ?? null,
      lastTargetEventsPerSecond: Math.round(
        (data.metrics.target_batches_per_second?.values.value ?? 0) * BATCH,
      ),
    },
    'ramp',
  );
}
