// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Portable (class A) packages: pure TypeScript, no UI frameworks or host packages. */
const PORTABLE_PACKAGES = [
  'domain',
  'commands',
  'engine-core',
  'audio-contracts',
  'audio-dsp',
  'vocal-dsp',
  'midi-core',
  'midi-akai-mpk-mini-mk3',
  'project-storage',
  'platform-contracts',
  'assistant-core',
  'test-fixtures',
];

const portableGlob = `packages/{${PORTABLE_PACKAGES.join(',')}}/src/**/*.ts`;

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/src/generated/**',
    '**/next-env.d.ts',
    '.claude/**',
    'playwright-report/**',
    'test-results/**',
    'docs/**',
    '**/.vitest/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.mjs',
            '*.cjs',
            'apps/*/*.mjs',
            'packages/*/scripts/*.mjs',
            'scripts/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/tests/**/*.{ts,tsx}', 'e2e/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['packages/{ui,studio-react}/src/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
  {
    files: ['packages/{audio-web,platform-browser}/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    ignores: ['packages/**/tests/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['next', 'next/*'], message: 'Only apps/web may import Next.js.' }] },
      ],
    },
  },
  {
    // Portable packages must stay host- and framework-neutral (also enforced by
    // dependency-cruiser and by compiling their src without DOM/Node typings).
    files: [portableGlob],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'Portable packages must not depend on React.',
            },
            { group: ['next', 'next/*'], message: 'Portable packages must not depend on Next.js.' },
            {
              group: ['zustand', 'zustand/*', 'dexie'],
              message: 'Portable packages must not depend on UI/host state libraries.',
            },
            {
              group: [
                '@studio/react',
                '@studio/ui',
                '@studio/audio-web',
                '@studio/platform-browser',
              ],
              message: 'Portable packages must not import UI or host-adapter packages.',
            },
            {
              group: ['node:*', 'fs', 'path', 'os'],
              message: 'Portable packages must not import Node built-ins.',
            },
          ],
        },
      ],
    },
  },
);
