import { createConfig } from './packages/config/eslint.js';

export default [
  ...createConfig({
    ignores: ['infra/grafana/dashboards/**', '**/.cache/**', '.observability/**', '**/.terraform/**'],
    reactFiles: ['apps/admin/**/*.{ts,tsx}', 'apps/storefront/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
  }),
  { files: ['infra/k6/**/*.js'], languageOptions: { globals: { __ENV: 'readonly' } } },
];
