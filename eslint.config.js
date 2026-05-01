import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        WebAssembly: 'readonly',
        Worker: 'readonly',
        fetch: 'readonly',
        btoa: 'readonly',
        self: 'readonly',
        globalThis: 'readonly',
        decodeURIComponent: 'readonly',
        // WebExtension globals
        browser: 'readonly',
        chrome: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['node_modules/', 'browser-polyfill.js', 'meshopt_decoder.js'],
  },
];
