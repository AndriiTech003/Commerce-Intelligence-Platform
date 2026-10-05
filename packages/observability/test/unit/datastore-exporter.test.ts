import { describe, expect, it } from 'vitest';
import { createExporter, parseRedisInfo } from '../../../../infra/prometheus/datastore-exporter.mjs';

describe('datastore exporter', () => {
  it('parses Redis INFO sections and keyspace lines', () => {
    const info = parseRedisInfo(
      '# Clients\r\nconnected_clients:7\r\n\r\n# Keyspace\r\ndb1:keys=42,expires=3,avg_ttl=0\r\n',
    );
    expect(info.connected_clients).toBe('7');
    expect(info.db1).toBe('keys=42,expires=3,avg_ttl=0');
  });

  it('reports every datastore as down instead of failing the scrape', async () => {
    const scrape = createExporter({
      postgresUrl: 'postgres://127.0.0.1:1/postgres',
      redisHost: '127.0.0.1',
      redisPort: 1,
      clickhouseUrl: 'http://127.0.0.1:1',
      timeoutMs: 1000,
    });
    const body = await scrape();
    expect(body).toContain('pg_up 0');
    expect(body).toContain('redis_up 0');
    expect(body).toContain('clickhouse_up 0');
    expect(body).toContain('# exporter error: postgres:');
    expect(body).toMatch(/# TYPE datastore_exporter_scrape_seconds gauge/);
  });
});
