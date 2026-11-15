/**
 * POST /api/test-donation-undos: one pass that undoes the donations the automatic paid tests
 * made. FOR THE END-TO-END TEST PEOPLE ONLY. Track C owns this file. The rules are in
 * #lib/server/backend/test-donation-undos.ts.
 *
 * It takes no body and names nobody: which donations are undone is decided by the email
 * domain of the campaign's creator and by the wallet the item's ledger says paid, which must
 * be registered in our own database to a test person; by nothing a caller sends. Such a
 * donation is sent back to the wallet it was paid from, out of the donation item's own twin,
 * and taken out of the campaign's total. Nobody else's donation is touched.
 *
 * Not for the public: the caller must send the same shared-secret header as the check-in
 * endpoint. On the live site Cloudflare's timer calls it once a minute, in-process, after the
 * reconcile pass and the test-account refunds (#lib/server/backend/worker.ts). A person who
 * holds the secret can call it.
 *
 * Each pass that had something to consider writes one line to the Worker's logs: how many
 * donations were sent back, how many were skipped and for which reasons, and whether a
 * person needs to look. Counts and reason names only.
 *
 * THIS ENDPOINT MOVES MONEY when it is called with real configuration: test amounts, from
 * Tejido's own donation item twins to wallets registered to the test accounts. Calling it
 * again is safe: a donation is never sent back twice. The merchant account is used; no
 * person's token is involved.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { campaignSiteOrigin } from '#lib/server/backend/donation-items.ts';
import { passLogLine, undoTestDonations } from '#lib/server/backend/test-donation-undos.ts';
import type { RequestHandler } from './$types';

/** Compares in constant time, whatever the lengths. As in the check-in endpoint. */
function sameSecret(given: string | null, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return given !== null && timingSafeEqual(digest(given), digest(expected));
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { config, db, qatom } = locals.ctx;

	if (!sameSecret(request.headers.get(CHECKIN_SECRET_HEADER), config.CHECKIN_SHARED_SECRET)) {
		return json(
			{ error: 'unauthorized', message: 'Missing or wrong check-in secret.' },
			{ status: 401 }
		);
	}

	const report = await undoTestDonations({
		db,
		account: qatom.account,
		siteOrigin: campaignSiteOrigin(config)
	});

	// One line in the Worker's logs, so a pass that sent nothing is not invisible. Counts and
	// reason names only; nothing when there was nothing to consider.
	const line = passLogLine(report);
	if (line !== null) console.log(line);

	return json(report);
};
