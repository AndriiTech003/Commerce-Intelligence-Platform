import { sampleBeta } from './beta';
import type { Rng } from './random';

export const WARMUP_IMPRESSIONS = 50;
export const HOLDOUT_PERCENT = 10;

export interface ArmState {
  creativeId: string;
  alpha: number;
  beta: number;
  impressions: number;
  successes: number;
}

export function parseBanditHash(hash: Record<string, string>, creativeIds: string[]): ArmState[] {
  return creativeIds.map((creativeId) => {
    const alpha = Number(hash[`${creativeId}:a`] ?? 1);
    const beta = Number(hash[`${creativeId}:b`] ?? 1);
    return {
      creativeId,
      alpha: Number.isFinite(alpha) && alpha > 0 ? alpha : 1,
      beta: Number.isFinite(beta) && beta > 0 ? beta : 1,
      impressions: Number(hash[`${creativeId}:n`] ?? 0) || 0,
      successes: Number(hash[`${creativeId}:s`] ?? 0) || 0,
    };
  });
}

export interface ArmChoice {
  chosen: string;
  samples: Record<string, number>;
  policy: 'thompson_sampling' | 'warmup' | 'holdout_uniform';
}

export function thompsonChoose(arms: ArmState[], rng: Rng, warmup = WARMUP_IMPRESSIONS): ArmChoice {
  if (arms.length === 0) throw new RangeError('no arms');
  const samples: Record<string, number> = {};
  for (const arm of arms) samples[arm.creativeId] = sampleBeta(arm.alpha, arm.beta, rng);
  const cold = arms.filter((arm) => arm.impressions < warmup);
  if (cold.length > 0) {
    const chosen = cold[Math.floor(rng() * cold.length)]!;
    return { chosen: chosen.creativeId, samples, policy: 'warmup' };
  }
  let best = arms[0]!;
  for (const arm of arms) if (samples[arm.creativeId]! > samples[best.creativeId]!) best = arm;
  return { chosen: best.creativeId, samples, policy: 'thompson_sampling' };
}

export function uniformChoose(arms: ArmState[], rng: Rng): ArmChoice {
  const chosen = arms[Math.floor(rng() * arms.length)]!;
  return { chosen: chosen.creativeId, samples: {}, policy: 'holdout_uniform' };
}

export function isHoldout(bucket: number, percent = HOLDOUT_PERCENT): boolean {
  return bucket < percent;
}

export const BANDIT_IMPRESSION_LUA = `
local state = KEYS[1]
local seen = KEYS[2]
local creative = ARGV[1]
local gamma = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if not redis.call('SET', seen, '1', 'NX', 'EX', ttl) then return 0 end
if gamma < 1 then
  local all = redis.call('HGETALL', state)
  for i = 1, #all, 2 do
    local field = all[i]
    local suffix = string.sub(field, -2)
    if suffix == ':a' or suffix == ':b' then
      redis.call('HSET', state, field, string.format('%.6f', 1 + gamma * (tonumber(all[i + 1]) - 1)))
    end
  end
end
if redis.call('HEXISTS', state, creative .. ':a') == 0 then
  redis.call('HSET', state, creative .. ':a', '1', creative .. ':b', '1')
end
redis.call('HINCRBYFLOAT', state, creative .. ':b', 1)
redis.call('HINCRBY', state, creative .. ':n', 1)
return 1
`;

export const BANDIT_SUCCESS_LUA = `
local state = KEYS[1]
local seen = KEYS[2]
local done = KEYS[3]
local creative = ARGV[1]
local gamma = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if not redis.call('SET', done, '1', 'NX', 'EX', ttl) then return 0 end
if redis.call('SET', seen, '1', 'NX', 'EX', ttl) then
  if gamma < 1 then
    local all = redis.call('HGETALL', state)
    for i = 1, #all, 2 do
      local field = all[i]
      local suffix = string.sub(field, -2)
      if suffix == ':a' or suffix == ':b' then
        redis.call('HSET', state, field, string.format('%.6f', 1 + gamma * (tonumber(all[i + 1]) - 1)))
      end
    end
  end
  if redis.call('HEXISTS', state, creative .. ':a') == 0 then
    redis.call('HSET', state, creative .. ':a', '1', creative .. ':b', '1')
  end
  redis.call('HINCRBYFLOAT', state, creative .. ':b', 1)
  redis.call('HINCRBY', state, creative .. ':n', 1)
end
if redis.call('HEXISTS', state, creative .. ':a') == 0 then
  redis.call('HSET', state, creative .. ':a', '1', creative .. ':b', '1')
end
redis.call('HINCRBYFLOAT', state, creative .. ':a', 1)
local b = tonumber(redis.call('HGET', state, creative .. ':b')) or 1
if b - 1 < 1 then
  redis.call('HSET', state, creative .. ':b', '1')
else
  redis.call('HSET', state, creative .. ':b', string.format('%.6f', b - 1))
end
redis.call('HINCRBY', state, creative .. ':s', 1)
return 1
`;

export const BANDIT_RESTORE_LUA = `
local state = KEYS[1]
if redis.call('EXISTS', state) == 1 then return 0 end
for i = 1, #ARGV, 2 do
  redis.call('HSET', state, ARGV[i], ARGV[i + 1])
end
return 1
`;
