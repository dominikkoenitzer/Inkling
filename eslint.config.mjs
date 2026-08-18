import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * Type-aware linting is deliberately off: `bun run typecheck` already runs the
 * compiler over both project configs, so turning it on here would pay for a
 * second full type-check to re-report what tsc has already said.
 *
 * The three source areas run in different places — the main process in Node,
 * the renderer in Chromium, the preload bridge in both — so each gets the
 * globals it actually has instead of one union that hides typos.
 */
export default tseslint.config(
  {
    ignores: ['out', 'release', 'dist', 'coverage', 'node_modules', 'resources']
  },
  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    // Renderer: Chromium, React 19, hot-reloaded by electron-vite.
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    // Main process, build config and scripts: Node.
    files: [
      'src/main/**/*.ts',
      'electron.vite.config.ts',
      'vitest.config.mts',
      'scripts/**/*.mjs',
      'test/**/*.ts'
    ],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    // The preload bridge is a Node context wired into the renderer's window.
    files: ['src/preload/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    }
  }
)
