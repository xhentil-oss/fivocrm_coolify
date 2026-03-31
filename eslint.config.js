import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        HTMLElement: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        FormData: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        Navigator: 'readonly',
        navigator: 'readonly',
        AudioContext: 'readonly',
        DOMParser: 'readonly',
        Node: 'readonly',
        Element: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
        ReturnType: 'readonly',
        Record: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
        Date: 'readonly',
        Array: 'readonly',
        Object: 'readonly',
        Number: 'readonly',
        String: 'readonly',
        Math: 'readonly',
        JSON: 'readonly',
        Error: 'readonly',
        RegExp: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLDivElement: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // TypeScript
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',

      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-undef': 'off', // TypeScript handles this
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'android/', 'api/', '*.config.*'],
  },
];
