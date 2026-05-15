// ESLint flat config — FrostERP
// Foco: pegar erros reais (no-undef, hooks rules) sem ruido excessivo.
// Warnings de estilo ficam soltos pra serem limpos incrementalmente.

import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'android/**',
      'landing/**',
      'docs/**',
      'public/**',
      '*.config.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}', 'api/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        // PWA / Vite
        self: 'readonly',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: '19' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // React 19: novo JSX transform — nao precisa importar React em escopo
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Erros: catch acoes inseguras
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      // Warnings: limpa incrementalmente
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'react/no-unescaped-entities': 'warn',
      'react/jsx-key': 'warn',
      // Vitest globals (describe/it/expect)
    },
  },
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
  },
  {
    // Service worker tem globals proprios
    files: ['src/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        self: 'readonly',
        clients: 'readonly',
      },
    },
  },
];
