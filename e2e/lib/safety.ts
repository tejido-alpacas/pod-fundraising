/**
 * What the suite refuses to do, whatever its configuration says.
 *
 * It signs real test people in and can spend a real deposit, so it runs against the two live
 * hostnames and nothing else, unless a person switches that off on purpose. And it types an
 * email address or a sign-in code into one host only: Qatom's.
 */
import { PRODUCTION_APP_URL, PRODUCTION_SITE_URL, type E2eConfig } from './config.ts';

export class SafetyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SafetyError';
	}
}

/**
 * Refuses to run against any site but the live one, unless `E2E_ALLOW_OTHER_HOSTS=true`.
 * A paid run is refused anywhere else without exception: the deposit is real wherever it is paid.
 */
export function assertSafeToRun(config: E2eConfig): void {
	const production = config.appUrl === PRODUCTION_APP_URL && config.siteUrl === PRODUCTION_SITE_URL;
	if (production) return;

	if (config.paid) {
		throw new SafetyError(
			`E2E_PAID=true is only allowed against ${PRODUCTION_APP_URL} and ${PRODUCTION_SITE_URL}. ` +
				'Unset E2E_APP_URL and E2E_SITE_URL, or unset E2E_PAID.'
		);
	}
	if (!config.allowOtherHosts) {
		throw new SafetyError(
			`The suite runs against ${PRODUCTION_APP_URL} and ${PRODUCTION_SITE_URL} only, and was given ` +
				`${config.appUrl} and ${config.siteUrl}. Set E2E_ALLOW_OTHER_HOSTS=true to allow that on purpose.`
		);
	}
}

/** True when `url` is on exactly this origin. */
export function onOrigin(url: string, origin: string): boolean {
	try {
		return new URL(url).origin === new URL(origin).origin;
	} catch {
		return false;
	}
}

/**
 * Refuses to type a test person's email address or sign-in code anywhere but Qatom's own
 * sign-in pages, served over HTTPS. The message names hosts only, never a whole address:
 * a sign-in URL carries values that do not belong in a log.
 */
export function assertQatomPage(url: string, config: Pick<E2eConfig, 'qatomHost'>): void {
	let host = 'an unreadable address';
	try {
		const parsed = new URL(url);
		if (parsed.protocol === 'https:' && parsed.hostname === config.qatomHost) return;
		host = parsed.host;
	} catch {
		// Falls through to the refusal below.
	}
	throw new SafetyError(
		`The sign-in is on ${host}, not on https://${config.qatomHost}. Nothing was typed there.`
	);
}
