import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * One config for three environments: the Express server, the React app, and
 * the test suites. The rules are chosen to catch mistakes rather than to
 * enforce a house style — formatting arguments are not worth a build failure.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      'web/dist/**',
      'server/covers/**',
      '**/*.min.js',
    ],
  },

  js.configs.recommended,

  // ---- shared rules -------------------------------------------------------
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      // An unused variable is usually a leftover or a typo. Deliberate ones
      // are spelled with a leading underscore, which the codebase already does.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          // `const { maxAge, ...rest } = x` drops a key on purpose.
          ignoreRestSiblings: true,
        },
      ],
      // Awaiting in a loop is deliberate in the seed, where ids must come out
      // in order, so the rule is off rather than suppressed line by line.
      'no-await-in-loop': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
    },
  },

  // ---- server -------------------------------------------------------------
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'test/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ---- React app ----------------------------------------------------------
  {
    files: ['web/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // Prop types are a runtime check this project does not use; the shapes
      // are checked by the type pass instead.
      'react/prop-types': 'off',
      // Seven places clear state before an async fetch, or seed a form field
      // from the signed-in user. Both cost an extra render pass rather than
      // being wrong, and removing them means restructuring how those screens
      // derive state — worth doing, not worth failing a build over today.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // ---- tests --------------------------------------------------------------
  {
    files: ['**/test/**/*.{js,mjs}', '**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
