/**
 * Shared by the route tests. Not used by the app itself.
 *
 * `cookieJar` behaves like one browser's cookies across several requests. `outcome` calls a
 * route handler and reports how it ended, since SvelteKit handlers end a request by throwing
 * a redirect or an error as often as by returning a response.
 */
import { isHttpError, isRedirect, type Cookies } from '@sveltejs/kit';

export interface CookieJar extends Cookies {
	/** What the browser currently holds, by cookie name. */
	readonly held: Map<string, string>;
}

export function cookieJar(): CookieJar {
	const held = new Map<string, string>();
	return {
		held,
		get: (name) => held.get(name),
		getAll: () => [...held].map(([name, value]) => ({ name, value })),
		set: (name, value) => void held.set(name, value),
		delete: (name) => void held.delete(name),
		parse: (header) => {
			const [pair = ''] = header.split(';');
			const equals = pair.indexOf('=');
			return { name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim() };
		},
		serialize: (name, value) => `${name}=${value}`
	};
}

export type Outcome =
	| { kind: 'response'; response: Response }
	| { kind: 'redirect'; status: number; location: string }
	| { kind: 'error'; status: number; message: string };

export async function outcome(run: () => Response | Promise<Response>): Promise<Outcome> {
	try {
		return { kind: 'response', response: await run() };
	} catch (thrown) {
		if (isRedirect(thrown)) {
			return { kind: 'redirect', status: thrown.status, location: thrown.location };
		}
		if (isHttpError(thrown)) {
			return { kind: 'error', status: thrown.status, message: thrown.body.message };
		}
		throw thrown;
	}
}
