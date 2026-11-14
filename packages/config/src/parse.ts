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
		'Locally, set them in .env at the repository root (copy .env.example to start).',
		'Deployed, they are the Worker secrets that infra/deploy.sh uploads. Nothing has a default.'
	].join('\n');
}

/**
 * Parses configuration from a set of values against the one schema: a Worker's `env`, the environment in Node. Names it does not know, such as the D1 and R2 bindings,
 * are ignored.
 * Pure: it reads nothing but its argument. Throws ConfigError listing every problem at once.
 */
export function parseConfig(env: Readonly<Record<string, unknown>>): Config {
	// A blank value is a missing value. There is no such thing as an empty secret.
	const input: Record<string, string> = {};
	for (const name of CONFIG_NAMES) {
		const raw = env[name];
		const value = typeof raw === 'string' ? raw.trim() : '';
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

	return result.data;
}
