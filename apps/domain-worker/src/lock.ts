import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export class DistributedLock {
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
  ) {}

  async acquire(ttlMs: number): Promise<string | null> {
    const token = randomBytes(16).toString('hex');
    const result = await this.redis.set(this.key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(token: string): Promise<boolean> {
    return (await this.redis.eval(RELEASE, 1, this.key, token)) === 1;
  }

  async withLock<T>(ttlMs: number, fn: () => Promise<T>): Promise<{ acquired: boolean; result?: T }> {
    const token = await this.acquire(ttlMs);
    if (!token) return { acquired: false };
    try {
      return { acquired: true, result: await fn() };
    } finally {
      await this.release(token).catch(() => false);
    }
  }
}
