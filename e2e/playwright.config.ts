import { defineConfig, devices } from '@playwright/test';

export const PORTS = { api: 4170, collector: 4171, gateway: 4172, storefront: 4175, admin: 4176 };

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts/,
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  outputDir: '../test-results',
  globalTeardown: './teardown.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node scripts/stack.mjs e2e',
    env: {
      PROFILE_SNAPSHOT_INTERVAL_MS: '5000',
      BANDIT_SNAPSHOT_INTERVAL_MS: '30000',
      DECISION_CACHE_MS: '500',
      SIM_PAGE_DELAY_MIN_MS: '50',
      SIM_PAGE_DELAY_MAX_MS: '150',
    },
    cwd: '..',
    url: `http://127.0.0.1:${PORTS.admin}/login`,
    timeout: 240000,
    reuseExistingServer: false,
    stdout: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30000 },
  },
});
