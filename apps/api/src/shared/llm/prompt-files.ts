import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const MODULE_PROMPTS = ['campaigns', 'analytics'];

export const PROMPT_DIRS = [
  join(here, 'prompts'),
  join(here, '..', 'prompts'),
  ...MODULE_PROMPTS.map((m) => join(here, '..', '..', 'modules', m, 'prompts')),
  ...MODULE_PROMPTS.map((m) => join(here, '..', 'src', 'modules', m, 'prompts')),
];

export async function loadPromptFile(version: string): Promise<string> {
  for (const dir of PROMPT_DIRS) {
    const file = join(dir, `${version}.md`);
    if (existsSync(file)) return readFile(file, 'utf8');
  }
  throw new Error(`prompt ${version} not found in ${PROMPT_DIRS.join(', ')}`);
}

export function splitPromptFile(content: string): { system: string; user: string } {
  const marker = /^---\s*user\s*---\s*$/im;
  const [system, user] = content.split(marker);
  return {
    system: (system ?? '').replace(/^---\s*system\s*---\s*$/im, '').trim(),
    user: (user ?? '').trim(),
  };
}
