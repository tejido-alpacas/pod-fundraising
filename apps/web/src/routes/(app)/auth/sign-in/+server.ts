/**
 * GET /auth/sign-in: sends the browser to Qatom to sign in. Track B owns this file.
 *
 *   /auth/sign-in?party={partyId}&return_to=/app/chat
 *
 * `party` is the party an invite link was for. The callback only links wallets to that party
 * if the person who signs in has the email the invite was sent to. Without `party` the person
 * is signed in and nothing is linked.
 *
 * This is Qatom identity 1, a person. It uses OIDC_* only.
 */
import { redirect } from '@sveltejs/kit';
import { writeSignInState } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** A path on this site, never another site. */
function safeReturnTo(value: string | null): string {
	return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
		? value
		: '/';
}

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { config, qatom } = locals.ctx;

	const { authorizationUrl, pending } = await qatom.person.begin();

	writeSignInState(cookies, config.SESSION_SECRET, {
		pending,
		partyId: url.searchParams.get('party'),
		returnTo: safeReturnTo(url.searchParams.get('return_to'))
	});

	// The only place we send a browser off-site: to the provider at PAYMENT_API_URL.
	redirect(302, authorizationUrl, { external: [new URL(authorizationUrl).origin] });
};
