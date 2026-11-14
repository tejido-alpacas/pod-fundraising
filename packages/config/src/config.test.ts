import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	CONFIG_NAMES,
	ConfigError,
	databaseFilePath,
	evidenceDirectory,
	findRepositoryRoot,
	parseConfig,
	PLACEHOLDER
} from './index.ts';

const BASE_DIR = '/srv/tejido';

const valid = {
	DATABASE_URL: 'file:./data/tejido.db',
	SESSION_SECRET: 'session-secret-session-secret-session',
	CHECKIN_SHARED_SECRET: 'checkin-secret-checkin-secret-checkin',
	PAYMENT_API_URL: 'https://pay.stage.m.todaq.net',
	QATOM_MCP_URL: 'https://mcp.example.test/tejido',
	OIDC_CLIENT_ID: 'sign-in-client',
	OIDC_REDIRECT_URI: 'http://localhost:5173/auth/callback',
	QATOM_ACCOUNT_CLIENT_ID: 'merchant-account',
	QATOM_ACCOUNT_CLIENT_SECRET: 'merchant-account-secret',
	ANTHROPIC_API_KEY: 'anthropic-key'
} satisfies Record<(typeof CONFIG_NAMES)[number], string>;

function problemsOf(env: Record<string, string | undefined>) {
	try {
		parseConfig(env, { baseDir: BASE_DIR });
	} catch (error) {
		if (error instanceof ConfigError) return error;
		throw error;
	}
	throw new Error('expected parseConfig to throw');
}

describe('parseConfig', () => {
	it('expects exactly the ten documented names', () => {
		expect(CONFIG_NAMES).toEqual([
			'DATABASE_URL',
			'SESSION_SECRET',
			'CHECKIN_SHARED_SECRET',
			'PAYMENT_API_URL',
			'QATOM_MCP_URL',
			'OIDC_CLIENT_ID',
			'OIDC_REDIRECT_URI',
			'QATOM_ACCOUNT_CLIENT_ID',
			'QATOM_ACCOUNT_CLIENT_SECRET',
			'ANTHROPIC_API_KEY'
		]);
	});

	it('returns every value when all are present', () => {
		const config = parseConfig(valid, { baseDir: BASE_DIR });
		expect(config).toEqual({ ...valid, DATABASE_URL: 'file:/srv/tejido/data/tejido.db' });
	});

	it('ignores names it does not know', () => {
		const config = parseConfig(
			{ ...valid, PATH: '/usr/bin', HOME: '/root' },
			{ baseDir: BASE_DIR }
		);
		expect(Object.keys(config).sort()).toEqual([...CONFIG_NAMES].sort());
	});

	it.each(CONFIG_NAMES)('refuses to start without %s', (name) => {
		const error = problemsOf({ ...valid, [name]: undefined });
		expect(error.problems).toEqual([{ name, problem: 'is not set' }]);
	});

	it.each(CONFIG_NAMES)('treats a blank %s as missing: there is no empty secret', (name) => {
		expect(problemsOf({ ...valid, [name]: '' }).problems).toEqual([
			{ name, problem: 'is not set' }
		]);
		expect(problemsOf({ ...valid, [name]: '   ' }).problems).toEqual([
			{ name, problem: 'is not set' }
		]);
	});

	it.each(CONFIG_NAMES)('refuses the placeholder for %s', (name) => {
		expect(problemsOf({ ...valid, [name]: PLACEHOLDER }).problems).toEqual([
			{ name, problem: 'still has the placeholder value from .env.example' }
		]);
	});

	it('reports every problem at once', () => {
		const error = problemsOf({});
		expect(error.problems.map((problem) => problem.name)).toEqual(CONFIG_NAMES);
		for (const name of CONFIG_NAMES) expect(error.message).toContain(name);
		expect(error.message).toContain('Tejido cannot start: 10 configuration values need attention.');
		expect(error.message).toContain('.env.example');
	});

	it('never puts a value in the error message', () => {
		const secret = 'do-not-print-this-secret-value-anywhere';
		const error = problemsOf({
			...valid,
			SESSION_SECRET: 'too-short',
			CHECKIN_SHARED_SECRET: `${secret} with spaces`,
			QATOM_ACCOUNT_CLIENT_SECRET: secret,
			QATOM_ACCOUNT_CLIENT_ID: valid.OIDC_CLIENT_ID
		});
		expect(error.message).not.toContain(secret);
		expect(error.message).not.toContain('too-short');
		expect(error.message).not.toContain(valid.OIDC_CLIENT_ID);
	});
});

describe('individual values', () => {
	it('SESSION_SECRET must be at least 32 characters', () => {
		expect(problemsOf({ ...valid, SESSION_SECRET: 'x'.repeat(31) }).problems[0]?.problem).toBe(
			'must be at least 32 characters'
		);
	});

	it('CHECKIN_SHARED_SECRET must be a value Qatom accepts as a header', () => {
		const problem = 'must be 32 or more printable characters with no spaces';
		expect(problemsOf({ ...valid, CHECKIN_SHARED_SECRET: 'short' }).problems[0]?.problem).toBe(
			problem
		);
		expect(
			problemsOf({ ...valid, CHECKIN_SHARED_SECRET: `${'x'.repeat(20)} ${'y'.repeat(20)}` })
				.problems[0]?.problem
		).toBe(problem);
		expect(
			problemsOf({ ...valid, CHECKIN_SHARED_SECRET: `${'x'.repeat(40)}é` }).problems[0]?.problem
		).toBe(problem);
	});

	it('PAYMENT_API_URL is an origin, stored without a trailing slash', () => {
		const parse = (value: string) =>
			parseConfig({ ...valid, PAYMENT_API_URL: value }, { baseDir: BASE_DIR }).PAYMENT_API_URL;

		expect(parse('https://pay.stage.m.todaq.net/')).toBe('https://pay.stage.m.todaq.net');
		expect(parse('http://localhost:8500')).toBe('http://localhost:8500');
	});

	it.each([
		'https://pay.stage.m.todaq.net/v4',
		'https://pay.stage.m.todaq.net/v4/oidc',
		'https://pay.stage.m.todaq.net?x=1',
		'pay.stage.m.todaq.net',
		'ftp://pay.stage.m.todaq.net'
	])('PAYMENT_API_URL refuses %s', (value) => {
		const [problem] = problemsOf({ ...valid, PAYMENT_API_URL: value }).problems;
		expect(problem?.name).toBe('PAYMENT_API_URL');
		expect(problem?.problem).toContain('must be an origin with no path');
	});

	it.each(['QATOM_MCP_URL', 'OIDC_REDIRECT_URI'] as const)('%s must be an http(s) URL', (name) => {
		expect(problemsOf({ ...valid, [name]: 'not a url' }).problems).toEqual([
			{ name, problem: 'must be an http or https URL' }
		]);
		expect(problemsOf({ ...valid, [name]: 'javascript:alert(1)' }).problems[0]?.name).toBe(name);
	});

	it('the sign-in client and the merchant account must be different credentials', () => {
		const error = problemsOf({ ...valid, QATOM_ACCOUNT_CLIENT_ID: valid.OIDC_CLIENT_ID });
		expect(error.problems).toHaveLength(1);
		expect(error.problems[0]?.name).toBe('QATOM_ACCOUNT_CLIENT_ID');
		expect(error.problems[0]?.problem).toContain('must not be the same as OIDC_CLIENT_ID');
	});
});

describe('DATABASE_URL', () => {
	const parse = (value: string) =>
		parseConfig({ ...valid, DATABASE_URL: value }, { baseDir: BASE_DIR });

	it('resolves a relative path against the repository root, with or without file:', () => {
		expect(parse('file:./data/tejido.db').DATABASE_URL).toBe('file:/srv/tejido/data/tejido.db');
		expect(parse('data/tejido.db').DATABASE_URL).toBe('file:/srv/tejido/data/tejido.db');
	});

	it('keeps an absolute path', () => {
		expect(parse('file:/var/lib/tejido/tejido.db').DATABASE_URL).toBe(
			'file:/var/lib/tejido/tejido.db'
		);
		expect(parse('/var/lib/tejido/tejido.db').DATABASE_URL).toBe('file:/var/lib/tejido/tejido.db');
	});

	it.each([':memory:', 'file::memory:', 'libsql://example.turso.io', 'https://example.test/db'])(
		'refuses %s: the database is a file on disk',
		(value) => {
			expect(problemsOf({ ...valid, DATABASE_URL: value }).problems[0]?.name).toBe('DATABASE_URL');
		}
	);

	it('puts uploaded evidence in a folder beside the database file', () => {
		const config = parse('file:./data/tejido.db');
		expect(databaseFilePath(config)).toBe('/srv/tejido/data/tejido.db');
		expect(evidenceDirectory(config)).toBe('/srv/tejido/data/evidence');
	});
});

describe('the repository', () => {
	const root = findRepositoryRoot(import.meta.dirname);

	it('is found by walking up to the package.json that declares workspaces', () => {
		expect(root).not.toBeNull();
		expect(findRepositoryRoot(join(root ?? '', 'packages', 'config', 'src'))).toBe(root);
	});

	it('ships a .env.example that names every value and can never start the app', () => {
		const example = parseEnv(readFileSync(join(root ?? '', '.env.example'), 'utf8'));

		expect(Object.keys(example).sort()).toEqual([...CONFIG_NAMES].sort());

		// Everything but the local database path is a placeholder, so copying the file
		// without editing it is refused rather than running with a published "secret".
		const error = problemsOf(example);
		expect(error.problems.map((problem) => problem.name)).toEqual(
			CONFIG_NAMES.filter((name) => name !== 'DATABASE_URL')
		);
		for (const { problem } of error.problems) {
			expect(problem).toBe('still has the placeholder value from .env.example');
		}
	});
});
