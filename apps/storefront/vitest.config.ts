import { defineConfig } from 'vitest/config';
import { unitConfig } from '@cip/config/vitest';

export default defineConfig({
  ...unitConfig({ include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'] }),
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
