/**
 * POST /auth/sign-out: ends the session on this browser. Track B owns this file.
 *
 * It is a POST, from the form on the home page, so that a link on another site cannot sign
 * someone out. It forgets our session and the tokens we kept for the agent chat; the person
 * stays signed in at Qatom.
 */
import { redirect } from '@sveltejs/kit';
import { forgetPersonTokens } from '#lib/server/person-tokens.ts';
import { clearSession } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	// The agent must not be able to act for someone who has signed out.
	if (locals.session?.partyId) {
		await forgetPersonTokens(locals.ctx.db, locals.session.partyId);
	}
	clearSession(cookies);
	redirect(303, '/');
};
