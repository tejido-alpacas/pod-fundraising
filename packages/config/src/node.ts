/**
 * @tejido/config/node: the parts that need Node and a checkout of the repository. Used by the
 * dev servers' Vite configuration and the database commands. Never imported by code that runs
 * in a Worker; that code calls `parseConfig(env)`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseConfig } from './parse.ts';
import type { Config } from './schema.ts';

/**
 * Walks up from `start` to the folder whose package.json declares workspaces. npm runs each
 * workspace's scripts from that workspace's own folder, so anything shared by both apps has
 * to be anchored here.
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

function repositoryRoot(): string {
	const root = findRepositoryRoot(import.meta.dirname);
	if (!root) throw new Error('Cannot find the repository root from packages/config.');
	return root;
}

/** The one `.env` file, at the repository root. Both dev servers hand it to their Worker. */
export function envFilePath(): string {
	return join(repositoryRoot(), '.env');
}

/**
 * Where the local D1 database and R2 bucket are kept: one folder, so both apps and the
 * database commands see the same data. This is the `v3` folder inside what
 * `wrangler --persist-to` is given.
 */
export function localStateDirectory(): string {
	return join(repositoryRoot(), 'data', 'wrangler', 'v3');
}

/**
 * Checks the local configuration: reads `.env` from the repository root if there is one, then
 * parses the environment. Values already in the environment win over the file.
 *
 * The dev servers call it as they start, so `npm run dev` refuses to start instead of failing
 * on the first request. Throws ConfigError if anything is missing or malformed.
 */
export function loadConfig(): Config {
	const envFile = envFilePath();
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	return parseConfig(process.env);
}
