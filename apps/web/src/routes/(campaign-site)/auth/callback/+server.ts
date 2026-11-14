/**
 * GET /auth/callback: where Qatom sends a donor's browser back. Track A owns this file.
 *
 * Copied from the App's callback (apps/app/src/routes/auth/callback/+server.ts), without the
 * invite. It finishes the sign-in and starts a session that holds only who the donor is: Qatom's
 * id for them and their email. Their tokens are not kept, and their wallets are not stored.
 *
 * Whatever goes wrong, no session is started and the donor is sent to /auth/problem, which
 * explains it in their language.
 */
import { redirect } from '@sveltejs/kit';
import { QatomError } from '@tejido/qatom';
import { takeDonorSignInState, writeDonorSession } from '#lib/campaign-site/server/session.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { config, qatom } = locals.ctx;

	const state = takeDonorSignInState(cookies, config.SESSION_SECRET);
	if (!state) redirect(303, '/auth/problem');

	let person;
	try {
		person = await qatom.person.complete(url, state.pending);
	} catch (cause) {
		if (!(cause instanceof QatomError)) throw cause;
		// A QatomError never carries a token, a header or a response body.
		console.error('Donor sign-in did not complete:', cause.name, cause.message);
		redirect(303, '/auth/problem');
	}

	writeDonorSession(cookies, config.SESSION_SECRET, { sub: person.sub, email: person.email });

	redirect(303, state.returnTo);
};
