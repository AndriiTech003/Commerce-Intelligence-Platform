import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/index.ts', 'src/reembed.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: true,
});
