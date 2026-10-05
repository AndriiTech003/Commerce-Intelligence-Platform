import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/main.ts',
    'src/seed.ts',
    'src/db/migrate-cli.ts',
    'src/openapi-emit.ts',
    'src/storage-setup.ts',
  ],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: true,
  onSuccess:
    'rm -rf dist/migrations dist/prompts && cp -R src/db/migrations dist/migrations && mkdir -p dist/prompts && cp src/modules/*/prompts/*.md dist/prompts/',
});
