import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintPluginPrettier from 'eslint-plugin-prettier/recommended'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintPluginPrettier,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true }
      ]
    }
  },
  {
    // Test doubles are plain `vi.fn()` stubs on object literals.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off'
    }
  },
  {
    // The editor is a browser bundle with its own tsconfig (DOM + JSX).
    files: ['web/**/*.ts', 'web/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './web/tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    ignores: [
      'plugin/**',
      'public/**',
      'node_modules/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts'
    ]
  }
)
