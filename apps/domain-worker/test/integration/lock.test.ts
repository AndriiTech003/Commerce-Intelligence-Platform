import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { DistributedLock } from '../../src/lock';

const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1');
const key = `tdw${randomBytes(3).toString('hex')}:lock:reservation-expiry`;

describe('distributed lock', () => {
  afterAll(async () => {
    await redis.del(key);
    redis.disconnect();
  });

  it('lets exactly one of many concurrent workers run the job', async () => {
    let runs = 0;
    const locks = Array.from({ length: 5 }, () => new DistributedLock(redis, key));
    const results = await Promise.all(
      locks.map((lock) =>
        lock.withLock(5000, async () => {
          runs += 1;
          await new Promise((r) => setTimeout(r, 100));
        }),
      ),
    );
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(runs).toBe(1);
    expect(await redis.exists(key)).toBe(0);
  });

  it('never releases a lock owned by someone else and expires', async () => {
    const a = new DistributedLock(redis, key);
    const token = await a.acquire(200);
    expect(token).not.toBeNull();
    expect(await a.release('not-mine')).toBe(false);
    expect(await new DistributedLock(redis, key).acquire(200)).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(await new DistributedLock(redis, key).acquire(200)).not.toBeNull();
  });
});
