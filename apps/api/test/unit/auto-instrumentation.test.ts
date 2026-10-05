import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function probe(enable: boolean): { pg: boolean; redis: boolean } {
  const script = `
${enable ? "import { enableAutoInstrumentation } from '@cip/observability';\nenableAutoInstrumentation();" : ''}
const pg = (await import('pg')).default;
const { Redis } = await import('ioredis');
process.stdout.write(JSON.stringify({
  pg: Boolean(pg.Client.prototype.query.__wrapped),
  redis: Boolean(Redis.prototype.sendCommand.__wrapped),
}));
`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: apiRoot,
    encoding: 'utf8',
  });
  return JSON.parse(out) as { pg: boolean; redis: boolean };
}

describe('OpenTelemetry auto-instrumentation under ESM', () => {
  it('wraps pg and ioredis when enabled before they are imported', () => {
    expect(probe(true)).toEqual({ pg: true, redis: true });
  });

  it('leaves pg and ioredis untouched otherwise', () => {
    expect(probe(false)).toEqual({ pg: false, redis: false });
  });
});
