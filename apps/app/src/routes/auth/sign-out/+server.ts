/**
 * POST /auth/sign-out: ends the session on this browser. Track B owns this file.
 *
 * It is a POST, from the form on the home page, so that a link on another site cannot sign
 * someone out. It forgets our session only; the person stays signed in at Qatom.
 */
import { redirect } from '@sveltejs/kit';
import { clearSession } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
	clearSession(cookies);
	redirect(303, '/');
};
