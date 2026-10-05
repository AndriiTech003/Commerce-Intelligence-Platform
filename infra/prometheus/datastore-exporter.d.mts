export function parseRedisInfo(text: string): Record<string, string>;
export function createExporter(options?: {
  postgresUrl?: string;
  redisHost?: string;
  redisPort?: number;
  clickhouseUrl?: string;
  databasePattern?: string;
  timeoutMs?: number;
}): () => Promise<string>;
