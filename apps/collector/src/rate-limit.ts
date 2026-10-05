import type { Redis } from 'ioredis';

const SLIDING_WINDOW = `
local current = KEYS[1]
local previous = KEYS[2]
local limit = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local window = tonumber(ARGV[4])
local prev = tonumber(redis.call('get', previous) or '0')
local curr = tonumber(redis.call('get', current) or '0')
local estimate = prev * (1 - elapsed) + curr
if estimate + cost > limit then
  return {0, math.floor(estimate)}
end
redis.call('incrby', current, cost)
redis.call('pexpire', current, window * 2)
return {1, math.floor(estimate + cost)}
`;

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export class SlidingWindowRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async consume(subject: string, cost: number, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const elapsed = (now % windowMs) / windowMs;
    const result = (await this.redis.eval(
      SLIDING_WINDOW,
      2,
      `${this.prefix}rl:${subject}:${window}`,
      `${this.prefix}rl:${subject}:${window - 1}`,
      limit,
      cost,
      elapsed,
      windowMs,
    )) as [number, number];
    return {
      allowed: result[0] === 1,
      limit,
      remaining: Math.max(0, limit - result[1]),
      resetMs: windowMs - (now % windowMs),
    };
  }
}
