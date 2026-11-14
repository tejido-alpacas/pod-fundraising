/**
 * GET /auth/sign-in: sends the browser to Qatom to sign in. Track B owns this file.
 *
 *   /auth/sign-in?party={partyId}&return_to=/chat
 *
 * `party` is the party an invite link was for. It is checked here, then carried to the
 * callback inside the sealed sign-in cookie, which the browser can neither read nor change.
 * The callback only links wallets to that party if the person who signs in has the email the
 * invite was sent to. Without `party` the person is signed in and nothing is linked.
 *
 * This is Qatom identity 1, a person. It uses OIDC_* only.
 */
import { redirect } from '@sveltejs/kit';
import { getParty } from '@tejido/db';
import { QatomError } from '@tejido/qatom';
import { mcpResource } from '#lib/server/person-tokens.ts';
import { writeSignInState } from '#lib/server/session.ts';
import { problemPath } from '#lib/server/sign-in-problem.ts';
import type { RequestHandler } from './$types';

/** A path on this site, never another site. */
function safeReturnTo(value: string | null): string {
	return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
		? value
		: '/';
}

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { config, db, qatom } = locals.ctx;

	// Not worth a trip to Qatom if the invite is not one of ours.
	const partyId = url.searchParams.get('party');
	if (partyId !== null && !(await getParty(db, partyId))) {
		redirect(303, problemPath('unknown_invite', null));
	}

	let started;
	try {
		// Name Tejido's Qatom MCP server and ask for long-lived access, so the tokens this
		// sign-in returns let the App's agent act as this person there, and can be renewed.
		started = await qatom.person.begin({
			resource: mcpResource(config.QATOM_MCP_URL),
			offlineAccess: true
		});
	} catch (cause) {
		if (!(cause instanceof QatomError)) throw cause;
		// A QatomError never carries a token, a header or a response body.
		console.error('Sign-in could not start:', cause.name, cause.message);
		redirect(303, problemPath('qatom_unavailable', partyId));
	}

	writeSignInState(cookies, config.SESSION_SECRET, {
		pending: started.pending,
		partyId,
		returnTo: safeReturnTo(url.searchParams.get('return_to'))
	});

	// The only place we send a browser off-site: to the provider at PAYMENT_API_URL.
	redirect(302, started.authorizationUrl, {
		external: [new URL(started.authorizationUrl).origin]
	});
};
