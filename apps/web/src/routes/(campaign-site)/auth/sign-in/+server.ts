/**
 * GET /auth/sign-in: sends a donor's browser to Qatom to sign in. Track A owns this file.
 *
 *   /auth/sign-in?return_to=/campaigns/library-wing
 *
 * Copied from the App's sign-in (apps/app/src/routes/auth/sign-in/+server.ts), without the
 * invite: a donor is not a party, so nothing is linked. It asks for no MCP access and no
 * long-lived tokens, because nothing on the Campaign Site acts for a donor at Qatom.
 *
 * This is Qatom identity 1, a person. It uses OIDC_* and the Campaign Site's own callback,
 * WEB_OIDC_REDIRECT_URI. The merchant account is never used here.
 */
import { redirect } from '@sveltejs/kit';
import { QatomError } from '@tejido/qatom';
import { safeReturnTo, writeDonorSignInState } from '#lib/campaign-site/server/session.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { config, qatom } = locals.ctx;

	let started;
	try {
		started = await qatom.person.begin();
	} catch (cause) {
		if (!(cause instanceof QatomError)) throw cause;
		// A QatomError never carries a token, a header or a response body.
		console.error('Donor sign-in could not start:', cause.name, cause.message);
		redirect(303, '/auth/problem');
	}

	writeDonorSignInState(cookies, config.SESSION_SECRET, {
		pending: started.pending,
		returnTo: safeReturnTo(url.searchParams.get('return_to'))
	});

	// The only place the Campaign Site sends a browser off-site: to the provider at PAYMENT_API_URL.
	redirect(302, started.authorizationUrl, {
		external: [new URL(started.authorizationUrl).origin]
	});
};
