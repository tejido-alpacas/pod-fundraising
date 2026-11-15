/**
 * POST /api/reconcile: runs one reconciliation pass and answers with a summary of it.
 * Track C owns this file. The rules are in #lib/server/backend/reconciler.ts.
 *
 * Not for the public: the caller must send the same shared-secret header as the check-in
 * endpoint. On the live site Cloudflare's timer calls it once a minute, in-process
 * (#lib/server/backend/worker.ts). A person who holds the secret can still call it.
 *
 * The ledgers are read with Tejido's merchant account only. No person's token is involved.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { reconcile } from '#lib/server/backend/reconciler.ts';
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

	return json(await reconcile(db, qatom.account));
};
