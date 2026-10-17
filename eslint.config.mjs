import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

// スコアカードの指摘に対応する規則を、各実行環境のソースに適用する。
export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'artifacts/**', '**/tests/**'],
  },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-deprecated': 'error',
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use Obsidian requestUrl in the plugin.' }],
    },
  },
  {
    files: ['packages/obsidian-plugin/src/**/*.ts'],
    plugins: { obsidianmd },
    rules: {
      'obsidianmd/no-unsupported-api': 'error',
      'obsidianmd/prefer-window-timers': 'error',
      'obsidianmd/settings-tab/prefer-setting-definitions': 'error',
      'obsidianmd/settings-tab/prefer-update-over-display': 'error',
    },
  },
];
