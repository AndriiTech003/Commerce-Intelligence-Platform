import { defineConfig } from 'vitest/config';
import { unitConfig } from '@cip/config/vitest';

export default defineConfig(unitConfig({ include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'] }));
