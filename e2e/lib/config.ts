/**
 * The suite's configuration, parsed once from the environment. This is the only file in `e2e/`
 * that reads `process.env`, and only through `loadE2eConfig`.
 *
 * Nothing here is a secret: the queue is reached with the AWS credentials already in the
 * environment (GitHub's OIDC role in the workflow), which this file never reads.
 */
import { z } from 'zod';

/** Where the suite runs unless told otherwise. `safety.ts` refuses anything else by default. */
export const PRODUCTION_APP_URL = 'https://app.tejido.net';
export const PRODUCTION_SITE_URL = 'https://tejido.net';

const origin = z.url().refine((value) => new URL(value).origin === value.replace(/\/$/, ''), {
	error: 'must be an origin with no path, such as https://app.tejido.net'
});
const hostname = z
	.string()
	.regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, {
		error: 'must be a bare hostname, with no scheme or path'
	});
const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
	error: 'must be an id: lower-case letters, digits and single hyphens'
});
/** On only when the value is exactly `true`. Anything else, or nothing, is off. */
const switchedOn = z
	.string()
	.optional()
	.transform((value) => value === 'true');

const schema = z.object({
	E2E_APP_URL: origin.default(PRODUCTION_APP_URL),
	E2E_SITE_URL: origin.default(PRODUCTION_SITE_URL),
	E2E_ALLOW_OTHER_HOSTS: switchedOn,
	E2E_QATOM_HOST: hostname,
	E2E_INBOX_QUEUE_URL: z.url({ protocol: /^https$/ }),
	E2E_INBOX_REGION: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, {
		error: 'must be an AWS region, such as ca-central-1'
	}),
	E2E_INBOX_DOMAIN: hostname,
	E2E_CAMPAIGN_ID: id,
	E2E_CONTRACTOR_PARTY_ID: id,
	E2E_CONFIRMER_PARTY_ID: id,
	E2E_PAID: switchedOn
});

export const E2E_CONFIG_NAMES = Object.keys(schema.shape) as (keyof typeof schema.shape)[];

export interface TestPerson {
	/** The party's id in Tejido's database. Its invite is at `/invite/{partyId}`. */
	partyId: string;
	/** The fixed address the party was invited at, on the inbox domain. */
	email: string;
}

export interface E2eConfig {
	appUrl: string;
	siteUrl: string;
	/** True only when `E2E_ALLOW_OTHER_HOSTS` is exactly `true`. */
	allowOtherHosts: boolean;
	/** The one host the sign-in may type an email address or a code into. */
	qatomHost: string;
	inbox: { queueUrl: string; region: string; domain: string };
	campaignId: string;
	contractor: TestPerson;
	confirmer: TestPerson;
	/** True only when `E2E_PAID` is exactly `true`: the paid spec then spends a real deposit. */
	paid: boolean;
}

/** Thrown when the suite's configuration is missing or malformed. Never contains a value. */
export class E2eConfigError extends Error {
	readonly names: string[];

	constructor(problems: { name: string; problem: string }[]) {
		const width = Math.max(...problems.map(({ name }) => name.length));
		super(
			[
				'The end-to-end suite cannot start. These environment variables need attention:',
				'',
				...problems.map(({ name, problem }) => `  ${name.padEnd(width)}  ${problem}`),
				'',
				'See e2e/README.md for what each one is and where its value comes from.'
			].join('\n')
		);
		this.name = 'E2eConfigError';
		this.names = problems.map(({ name }) => name);
	}
}

/** Pure: reads nothing but its argument. A blank value is a missing value. */
export function parseE2eConfig(env: Readonly<Record<string, string | undefined>>): E2eConfig {
	const input: Record<string, string> = {};
	for (const name of E2E_CONFIG_NAMES) {
		const value = env[name]?.trim();
		if (value) input[name] = value;
	}

	const result = schema.safeParse(input);
	if (!result.success) {
		const problems: { name: string; problem: string }[] = [];
		for (const issue of result.error.issues) {
			const name = String(issue.path[0] ?? 'configuration');
			if (problems.some((problem) => problem.name === name)) continue;
			problems.push({ name, problem: name in input ? issue.message : 'is not set' });
		}
		throw new E2eConfigError(problems);
	}

	const values = result.data;
	const person = (partyId: string, name: string): TestPerson => ({
		partyId,
		email: `${name}@${values.E2E_INBOX_DOMAIN}`
	});
	return {
		appUrl: values.E2E_APP_URL.replace(/\/$/, ''),
		siteUrl: values.E2E_SITE_URL.replace(/\/$/, ''),
		allowOtherHosts: values.E2E_ALLOW_OTHER_HOSTS,
		qatomHost: values.E2E_QATOM_HOST,
		inbox: {
			queueUrl: values.E2E_INBOX_QUEUE_URL,
			region: values.E2E_INBOX_REGION,
			domain: values.E2E_INBOX_DOMAIN
		},
		campaignId: values.E2E_CAMPAIGN_ID,
		contractor: person(values.E2E_CONTRACTOR_PARTY_ID, 'e2e-contractor'),
		confirmer: person(values.E2E_CONFIRMER_PARTY_ID, 'e2e-confirmer'),
		paid: values.E2E_PAID
	};
}

let loaded: E2eConfig | null = null;

/** The configuration from the environment, parsed the first time it is asked for. */
export function loadE2eConfig(): E2eConfig {
	loaded ??= parseE2eConfig(process.env);
	return loaded;
}
