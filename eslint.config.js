import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['**/coverage/**', '**/dist/**', 'node_modules/**'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['apps/api/**/*.{ts,tsx}'],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		files: ['apps/web/**/*.{ts,tsx}'],
		languageOptions: {
			globals: globals.browser,
		},
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
		},
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn',
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
		},
	},
	{
		files: ['apps/web/scripts/**/*.mjs'],
		languageOptions: { globals: globals.node },
	},
	{
		files: ['*.config.js', '*.config.mjs', '*.config.ts', 'eslint.config.js'],
		languageOptions: {
			globals: globals.node,
		},
	},
);
