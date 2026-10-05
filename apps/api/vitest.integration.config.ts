import { defineConfig } from 'vitest/config';
import { integrationConfig } from '@cip/config/vitest';

export default defineConfig(integrationConfig({ globalSetup: ['test/integration/global-setup.ts'] }));
