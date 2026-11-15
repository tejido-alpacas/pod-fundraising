/**
 * POST /api/test-account-refunds: one pass of refunds for the END-TO-END TEST PEOPLE ONLY.
 * Track C owns this file. The rules are in #lib/server/backend/test-account-refunds.ts.
 *
 * It takes no body and names nobody: who is refunded is decided by the email domain of the
 * party who paid, and by nothing a caller sends. A test person's deposits on a confirmed
 * milestone go back to their agent wallet, out of the twin the item is sold from. Nobody
 * else's deposits are touched; theirs go back through POST /api/refunds, to a primary wallet.
 *
 * Not for the public: the caller must send the same shared-secret header as the check-in
 * endpoint. On the live site Cloudflare's timer calls it once a minute, in-process, after the
 * reconcile pass (#lib/server/backend/worker.ts). A person who holds the secret can call it.
 *
 * Each pass that had something to consider writes one line to the Worker's logs: how many
 * transfers were sent, how many groups were skipped and for which reasons, and whether a
 * person needs to look. Counts and reason names only.
 *
 * THIS ENDPOINT MOVES MONEY when it is called with real configuration: test amounts, from
 * Tejido's own item twins to the test accounts' agent wallets. Calling it again is safe: a
 * deposit is never sent twice. The merchant account is used; no person's token is involved.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { passLogLine, refundTestAccounts } from '#lib/server/backend/test-account-refunds.ts';
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

	const report = await refundTestAccounts({ db, account: qatom.account });

	// One line in the Worker's logs, so a pass that sent nothing is not invisible. Counts and
	// reason names only; nothing when there was nothing to consider.
	const line = passLogLine(report);
	if (line !== null) console.log(line);

	return json(report);
};
