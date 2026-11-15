/**
 * POST /api/test-campaign-cleanup: one pass that deletes the campaigns the automatic
 * end-to-end tests created and are finished with. Track C owns this file. The rules are in
 * #lib/server/backend/test-campaign-cleanup.ts.
 *
 * THIS ENDPOINT DELETES DATA. It takes no body and names nothing: which campaigns go is
 * decided by the email addresses on each campaign, its age and its money, and by nothing a
 * caller sends. A campaign with anybody on it who is not a test person is never touched, and
 * neither is the fixed test campaign.
 *
 * Not for the public: the caller must send the same shared-secret header as the check-in
 * endpoint. On the live site Cloudflare's timer calls it once a minute, in-process, after the
 * other passes (#lib/server/backend/worker.ts). A person who holds the secret can call it.
 *
 * Each pass that had something to consider writes one line to the Worker's logs: how many
 * campaigns were deleted, how many were left and for which reasons. Counts and reason names
 * only.
 *
 * It calls nothing in Qatom and moves no money. Calling it again is safe.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cleanupLogLine, cleanUpTestCampaigns } from '#lib/server/backend/test-campaign-cleanup.ts';
import type { RequestHandler } from './$types';

/** Compares in constant time, whatever the lengths. As in the check-in endpoint. */
function sameSecret(given: string | null, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return given !== null && timingSafeEqual(digest(given), digest(expected));
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { config, db } = locals.ctx;

	if (!sameSecret(request.headers.get(CHECKIN_SECRET_HEADER), config.CHECKIN_SHARED_SECRET)) {
		return json(
			{ error: 'unauthorized', message: 'Missing or wrong check-in secret.' },
			{ status: 401 }
		);
	}

	const report = await cleanUpTestCampaigns({ db });

	// One line in the Worker's logs. Counts and reason names only; nothing when there was
	// nothing to consider.
	const line = cleanupLogLine(report);
	if (line !== null) console.log(line);

	return json(report);
};
