/**
 * POST /api/funding: reads every campaign's donation ledger once, stores the totals, and
 * answers with a summary of the pass. Track C owns this file. The rules are in
 * #lib/server/backend/funding.ts.
 *
 * Not for the public: the caller must send the same shared-secret header as the check-in
 * endpoint and POST /api/reconcile. Nothing calls this on a schedule yet; until a scheduled
 * trigger is added, a person or a job that holds the secret calls it. Calling it again is safe.
 *
 * The ledgers are read with Tejido's merchant account only. No person's token is involved,
 * nothing is written to Qatom and no money moves.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { refreshFunding } from '#lib/server/backend/funding.ts';
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

	return json(await refreshFunding(db, qatom.account));
};
