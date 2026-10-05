import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  platform: 'browser',
  target: 'es2020',
  dts: true,
  clean: true,
  minify: true,
  sourcemap: false,
});
