import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

// 公式スキャナーの設定に合わせる。実審査の代わりにはならない。
// https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md
const securityRules = new Set([
  'no-eval',
  'no-implied-eval',
  'no-unsanitized/method',
  'no-unsanitized/property',
  'obsidianmd/regex-lookbehind',
  'obsidianmd/no-forbidden-elements',
]);

const recommended = obsidianmd.configs.recommended.map(config => ({
  ...config,
  ...(config.rules && {
    rules: Object.fromEntries(Object.entries(config.rules).map(([name, value]) => {
      const [severity, ...options] = Array.isArray(value) ? value : [value];
      // 禁止された抑制コメントは、通常の助言と異なり審査を失敗させる。
      const keepError = securityRules.has(name) || name.startsWith('eslint-comments/');
      return [name, [keepError || severity === 'off' || severity === 0 ? severity : 'warn', ...options]];
    })),
  }),
}));

export default defineConfig([
  ...recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{ts,js}'],
    rules: {
      ...Object.fromEntries([...securityRules].map(name => [name, 'error'])),
      'no-undef': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      'import/no-unresolved': 'off',
      'obsidianmd/validate-manifest': 'off',
      'obsidianmd/validate-license': 'off',
      'obsidianmd/commands/no-command-in-command-id': 'off',
      'obsidianmd/commands/no-plugin-id-in-command-id': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/pkg/**',
      '**/.obsidian/**', '**/test-vault/**',
      '**/*.test.*', '**/*.tests.*', '**/*.spec.*', '**/*.specs.*',
      '**/test/**', '**/tests/**', '**/__tests__/**',
      '**/mocks/**', '**/__mocks__/**', '**/testUtils**',
      '**/*.cjs', '**/*.mjs', '**/*.cts', '**/*.mts', '**/vite*',
      '**/scripts/**', '**/docs/**',
      '**/i18n/**', '**/i18next/**', '**/locale/**', '**/locales/**',
      '**/translations/**', '**/l10n/**',
      '**/.pnpm-store/**', 'automation/**', 'e2e-tests/**',
    ],
  },
]);
