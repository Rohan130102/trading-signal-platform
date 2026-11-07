import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '.data/**',
      'playwright-report/**',
      'test-results/**',
      'apps/web/public/**',
      'apps/web/next-env.d.ts',
      'apps/mobile/.expo/**',
      'apps/mobile/expo-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/mobile/{app,src,test}/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['apps/mobile/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: [
      'scripts/**',
      'apps/api/src/scripts/**',
      'apps/api/test/**',
      'apps/mobile/e2e/**',
      'apps/mobile/scripts/**',
      'apps/mobile/test/**',
      'e2e/**',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        performance: 'readonly',
        Buffer: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
);
