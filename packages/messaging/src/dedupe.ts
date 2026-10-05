export interface RedisLike {
  set(key: string, value: string, secondsToken: 'EX', seconds: number, nx: 'NX'): Promise<'OK' | null>;
  exists(...keys: string[]): Promise<number>;
  pipeline(): {
    exists(key: string): unknown;
    set(key: string, value: string, secondsToken: 'EX', seconds: number): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
}

export interface Deduper {
  isProcessed(consumer: string, messageId: string): Promise<boolean>;
  markProcessed(consumer: string, messageId: string): Promise<void>;
  claim(consumer: string, messageId: string): Promise<boolean>;
  filterProcessed(consumer: string, messageIds: string[]): Promise<Set<string>>;
  markManyProcessed(consumer: string, messageIds: string[]): Promise<void>;
}

export class RedisDeduper implements Deduper {
  constructor(
    private readonly redis: RedisLike,
    private readonly options: { prefix?: string; ttlSeconds?: number } = {},
  ) {}

  private key(consumer: string, id: string): string {
    return `${this.options.prefix ?? ''}dedup:${consumer}:${id}`;
  }

  private get ttl(): number {
    return this.options.ttlSeconds ?? 48 * 3600;
  }

  async isProcessed(consumer: string, messageId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(consumer, messageId))) > 0;
  }

  async markProcessed(consumer: string, messageId: string): Promise<void> {
    await this.redis.set(this.key(consumer, messageId), '1', 'EX', this.ttl, 'NX');
  }

  async claim(consumer: string, messageId: string): Promise<boolean> {
    return (await this.redis.set(this.key(consumer, messageId), '1', 'EX', this.ttl, 'NX')) === 'OK';
  }

  async filterProcessed(consumer: string, messageIds: string[]): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set();
    const pipeline = this.redis.pipeline();
    for (const id of messageIds) pipeline.exists(this.key(consumer, id));
    const results = (await pipeline.exec()) ?? [];
    const seen = new Set<string>();
    results.forEach(([error, value], index) => {
      if (!error && Number(value) > 0) seen.add(messageIds[index]!);
    });
    return seen;
  }

  async markManyProcessed(consumer: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of messageIds) pipeline.set(this.key(consumer, id), '1', 'EX', this.ttl);
    await pipeline.exec();
  }
}

export class MemoryDeduper implements Deduper {
  private readonly seen = new Set<string>();

  async isProcessed(consumer: string, messageId: string): Promise<boolean> {
    return this.seen.has(`${consumer}:${messageId}`);
  }

  async markProcessed(consumer: string, messageId: string): Promise<void> {
    this.seen.add(`${consumer}:${messageId}`);
  }

  async claim(consumer: string, messageId: string): Promise<boolean> {
    const key = `${consumer}:${messageId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  async filterProcessed(consumer: string, messageIds: string[]): Promise<Set<string>> {
    return new Set(messageIds.filter((id) => this.seen.has(`${consumer}:${id}`)));
  }

  async markManyProcessed(consumer: string, messageIds: string[]): Promise<void> {
    for (const id of messageIds) this.seen.add(`${consumer}:${id}`);
  }
}
