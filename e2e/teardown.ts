import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default async function teardown() {
  for (let i = 0; i < 40; i++) {
    if (!existsSync(join(here, '..', '.smoke', 'e2e.json'))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const file = join(here, '..', '.smoke', 'e2e.json');
  if (existsSync(file)) {
    const stack = JSON.parse(readFileSync(file, 'utf8'));
    const { teardown: drop } = await import('../scripts/stack.mjs');
    await drop(stack);
  }
  for (const port of [4170, 4171, 4172, 4173, 4174, 4175, 4176, 4177]) {
    try {
      execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9`, { stdio: 'ignore' });
    } catch {
      continue;
    }
  }
}
