import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const noComments = {
  meta: { type: 'suggestion', docs: { description: 'disallow comments in source code' }, schema: [] },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({
            loc: comment.loc,
            message: 'Comments are not allowed in source code (project convention).',
          });
        }
      },
    };
  },
};

export function createConfig({ ignores = [], reactFiles = [] } = {}) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/.next/**',
        '**/node_modules/**',
        '**/coverage/**',
        '**/.turbo/**',
        'playwright-report/**',
        'test-results/**',
        '.smoke/**',
        '**/next-env.d.ts',
        ...ignores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.{ts,tsx,js,mjs,cjs}'],
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: { ...globals.node, ...globals.browser },
      },
      plugins: { local: { rules: { 'no-comments': noComments } } },
      rules: {
        'local/no-comments': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
        'no-constant-condition': ['error', { checkLoops: false }],
      },
    },
    {
      files: ['**/*.cjs'],
      languageOptions: { sourceType: 'commonjs' },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
      files: ['**/test/**/*.{ts,tsx}', 'e2e/**/*.ts', '**/*.test.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      files: reactFiles,
      plugins: { 'react-hooks': reactHooks },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
  );
}

export { noComments };
