import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// This app is a single-file React app that does NOT use PropTypes and relies on
// JSX element references to keep component identifiers "in use". We therefore:
//   - enable only eslint-plugin-react's jsx-uses-* rules (no prop-types / scope checks)
//   - keep the stable react-hooks rules (rules-of-hooks, exhaustive-deps)
//   - turn OFF the experimental react-hooks v7 rules that flag intentional
//     patterns used throughout this codebase
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,

      // Allow intentionally-omitted / underscore-prefixed bindings (e.g.
      // destructuring a key out of an object, or a reserved state setter pair).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],

      // ── eslint-plugin-react: only the JSX-usage markers we need ──
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',

      // ── react-hooks: stable rules stay on ──
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── react-hooks: experimental v7 rules are disabled (intentional patterns) ──
      'react-hooks/static-components': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
