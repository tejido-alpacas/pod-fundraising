import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CONFIG_NAMES, configSchema, type Config } from './schema.ts';

export interface ConfigProblem {
	name: string;
	problem: string;
}

/** Thrown when the configuration is missing or malformed. Its message never contains a value. */
export class ConfigError extends Error {
	readonly problems: ConfigProblem[];

	constructor(problems: ConfigProblem[]) {
		super(describe(problems));
		this.name = 'ConfigError';
		this.problems = problems;
	}
}

function describe(problems: ConfigProblem[]): string {
	const width = Math.max(...problems.map((problem) => problem.name.length));
	const count =
		problems.length === 1
			? '1 configuration value needs'
			: `${problems.length} configuration values need`;
	return [
		`Tejido cannot start: ${count} attention.`,
		'',
		...problems.map(({ name, problem }) => `  ${name.padEnd(width)}  ${problem}`),
		'',
		'Set them in .env at the repository root (copy .env.example to start), or in the environment.',
		'Nothing has a default.'
	].join('\n');
}

export interface ParseOptions {
	/** The folder a relative DATABASE_URL is resolved against. */
	baseDir: string;
}

/**
 * Parses configuration from a set of environment values against the one schema.
 * Pure: it reads nothing but its arguments. Throws ConfigError listing every problem at once.
 */
export function parseConfig(
	env: Readonly<Record<string, string | undefined>>,
	options: ParseOptions
): Config {
	// A blank value is a missing value. There is no such thing as an empty secret.
	const input: Record<string, string> = {};
	for (const name of CONFIG_NAMES) {
		const value = env[name]?.trim();
		if (value) input[name] = value;
	}

	const result = configSchema.safeParse(input);
	if (!result.success) {
		const problems: ConfigProblem[] = [];
		for (const issue of result.error.issues) {
			const name = String(issue.path[0] ?? 'configuration');
			// One line per name: the first problem is the one to fix.
			if (!problems.some((problem) => problem.name === name)) {
				problems.push({ name, problem: issue.message });
			}
		}
		throw new ConfigError(problems);
	}

	return { ...result.data, DATABASE_URL: toAbsoluteFileUrl(result.data.DATABASE_URL, options) };
}

function toAbsoluteFileUrl(value: string, { baseDir }: ParseOptions): string {
	const path = value.startsWith('file:') ? value.slice('file:'.length) : value;
	return `file:${isAbsolute(path) ? path : resolve(baseDir, path)}`;
}

/**
 * Loads configuration for this process: reads `.env` from the repository root if there is one,
 * then parses the environment. Values already in the environment win over the file.
 *
 * Call it once, at startup. Throws ConfigError if anything is missing or malformed.
 */
export function loadConfig(): Config {
	const baseDir = findRepositoryRoot(process.cwd()) ?? process.cwd();
	const envFile = join(baseDir, '.env');
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	return parseConfig(process.env, { baseDir });
}

/**
 * Walks up from `start` to the folder whose package.json declares workspaces. npm runs each
 * workspace's scripts from that workspace's own folder, so a relative path has to be anchored
 * here or the app and the seed script would open two different database files.
 */
export function findRepositoryRoot(start: string): string | null {
	let dir = resolve(start);
	for (;;) {
		const manifest = join(dir, 'package.json');
		if (existsSync(manifest) && declaresWorkspaces(manifest)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function declaresWorkspaces(manifest: string): boolean {
	try {
		const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
		return typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed;
	} catch {
		return false;
	}
}

/** The database file's absolute path on disk. */
export function databaseFilePath(config: Pick<Config, 'DATABASE_URL'>): string {
	return config.DATABASE_URL.slice('file:'.length);
}

/** Where uploaded evidence is stored: an `evidence` folder beside the database file. */
export function evidenceDirectory(config: Pick<Config, 'DATABASE_URL'>): string {
	return join(dirname(databaseFilePath(config)), 'evidence');
}
