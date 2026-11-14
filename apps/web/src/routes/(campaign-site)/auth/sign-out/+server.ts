/**
 * POST /auth/sign-out: ends a donor's session on this browser. Track A owns this file.
 *
 * It is a POST, from the form in the header, so that a link on another site cannot sign
 * someone out. The donor stays signed in at Qatom itself. No tokens were kept, so there is
 * nothing else to forget.
 */
import { redirect } from '@sveltejs/kit';
import { clearDonorSession, safeReturnTo } from '#lib/campaign-site/server/session.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ url, cookies }) => {
	clearDonorSession(cookies);
	redirect(303, safeReturnTo(url.searchParams.get('return_to')));
};
