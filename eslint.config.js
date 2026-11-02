import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'eslint.config.js',
      '**/vite.config.ts',
      'devvit.config.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // tsc reports unused locals and parameters (noUnusedLocals/Parameters).
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    // Server and shared code.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/client/**'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: ['./tsconfig.json'] },
    },
  },
  {
    // Browser code served by the web views.
    files: ['src/client/**/*.{js,ts}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { project: ['./tsconfig.client.json'] },
    },
  },
]);
