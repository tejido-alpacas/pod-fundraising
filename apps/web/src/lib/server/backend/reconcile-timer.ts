/**
 * One reconciliation pass, started by the timer instead of a person. Called by worker.ts.
 *
 * It asks the Worker's own request handler for `POST /api/reconcile`, with the shared-secret
 * header a person would send, and looks only at the status of the answer. The answer's body is
 * never read and nothing from it, or from the secret, reaches a message or a log.
 */
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';

export interface ReconcileOnTimerOptions {
	/** The Worker's own request handler. */
	respond: (request: Request) => Promise<Response>;
	/** The Campaign Site's origin, such as `https://tejido.net`. */
	origin: string;
	/** CHECKIN_SHARED_SECRET. */
	secret: string;
}

/** Answers with the status when the pass ran. Throws, naming the status only, when it did not. */
export async function reconcileOnTimer(options: ReconcileOnTimerOptions): Promise<number> {
	const request = new Request(new URL('/api/reconcile', options.origin), {
		method: 'POST',
		headers: {
			// The request comes from the site itself. Without this SvelteKit refuses a POST
			// that has no body as a cross-site form submission (403).
			origin: options.origin,
			[CHECKIN_SECRET_HEADER]: options.secret
		}
	});

	// If the handler itself throws, that error goes on to the Worker's logs as it is. SvelteKit
	// turns a route's own errors into a 500 answer, so that is rare.
	const response = await options.respond(request);
	await response.body?.cancel();
	if (!response.ok) {
		throw new Error(
			`Reconcile on the timer failed: POST /api/reconcile answered ${response.status}.`
		);
	}
	return response.status;
}

/**
 * The second thing the timer does, after the reconcile pass: one pass of refunds for the
 * END-TO-END TEST PEOPLE ONLY (`POST /api/test-account-refunds`), asked for in the same way.
 * Only the status of the answer is looked at.
 *
 * This is not `/api/refunds`, which refunds everyone else, to primary wallets, and is never
 * put on a timer.
 */
export async function refundTestAccountsOnTimer(options: ReconcileOnTimerOptions): Promise<number> {
	const request = new Request(new URL('/api/test-account-refunds', options.origin), {
		method: 'POST',
		headers: { origin: options.origin, [CHECKIN_SECRET_HEADER]: options.secret }
	});

	const response = await options.respond(request);
	await response.body?.cancel();
	if (!response.ok) {
		throw new Error(
			`Test-account refunds on the timer failed: POST /api/test-account-refunds answered ${response.status}.`
		);
	}
	return response.status;
}
