export function unitConfig(overrides = {}) {
  return {
    test: {
      include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
      ...overrides,
    },
  };
}

export function integrationConfig(overrides = {}) {
  return {
    test: {
      include: ['test/integration/**/*.test.ts'],
      testTimeout: 60000,
      hookTimeout: 180000,
      fileParallelism: false,
      ...overrides,
    },
  };
}
