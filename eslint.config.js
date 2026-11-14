// The one ESLint configuration for every workspace. Each workspace's `lint` script runs
// `eslint .` from its own folder and ESLint finds this file by walking up.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

// Packages that hold credentials, open the database or talk to Qatom. They may only be
// imported by code that runs on the server.
const SERVER_ONLY_PACKAGES = [
	'@tejido/config',
	'@tejido/db',
	'@tejido/db/*',
	'@tejido/qatom',
	'@tejido/qatom/*'
];

// The files in the web app that are guaranteed to run on the server only.
const WEB_SERVER_FILES = [
	'apps/web/src/**/server/**',
	'apps/web/src/**/*.server.ts',
	'apps/web/src/**/+server.ts',
	'apps/web/src/hooks.server.ts',
	'apps/web/src/**/*.test.ts'
];

export default defineConfig(
	globalIgnores([
		'**/node_modules/',
		'**/.svelte-kit/',
		'**/build/',
		'**/dist/',
		'**/coverage/',
		'packages/db/drizzle/',
		'data/'
	]),

	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,

	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint advises turning this off: TypeScript already reports undefined names.
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	},

	// Type-aware rules. A forgotten `await` on a database write or a Qatom call is the bug
	// these exist to catch.
	{
		files: ['**/*.ts', '**/*.svelte'],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': [
				'error',
				{ checksVoidReturn: { attributes: false } }
			],
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/consistent-type-imports': 'error'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: { extraFileExtensions: ['.svelte'], parser: ts.parser }
		}
	},

	// Configuration is parsed once, by @tejido/config. Nothing else reads process.env.
	{
		files: ['apps/**/*.{ts,svelte}', 'packages/**/*.ts'],
		ignores: [
			'packages/config/**',
			'apps/web/vite.config.ts',
			'apps/web/src/lib/server/context.ts',
			'**/*.test.ts'
		],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: "MemberExpression[object.name='process'][property.name='env']",
					message:
						'Do not read process.env here. Configuration is parsed once by @tejido/config; in the web app use event.locals.ctx.config.'
				}
			]
		}
	},

	// The merchant account's credentials, the database and the Qatom client never reach the browser.
	{
		files: ['apps/web/src/**/*.{ts,svelte}'],
		ignores: WEB_SERVER_FILES,
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: SERVER_ONLY_PACKAGES,
							allowTypeImports: true,
							message:
								'Server-only package. Import it from a +page.server.ts, a +server.ts, or a module under src/lib/server.'
						}
					]
				}
			]
		}
	},

	// Only packages/qatom talks to Qatom, and it reads no configuration of its own.
	{
		files: ['packages/qatom/**/*.ts'],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@tejido/config', '@tejido/db', '@tejido/db/*'],
							message:
								'packages/qatom takes its settings as arguments and knows nothing about our database.'
						}
					]
				}
			],
			'no-console': 'error'
		}
	}
);
