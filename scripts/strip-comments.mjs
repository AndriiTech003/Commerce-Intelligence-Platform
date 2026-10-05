import { readFileSync, writeFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .filter((line, index, lines) => !(line.trim() === '' && (lines[index - 1] ?? '').trim() === ''))
    .join('\n');
  writeFileSync(file, stripped);
}
