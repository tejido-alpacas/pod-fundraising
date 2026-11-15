/**
 * POST /api/schedule: runs one pass of the cadence scheduler and answers with counts and the
 * reminders it recorded. Track C owns this file. The pass is in
 * #lib/server/backend/schedule.ts; the rules for what is due are in @tejido/db (schedule.ts).
 *
 * Not for the public: the caller must send the same shared-secret header as the check-in
 * endpoint and POST /api/reconcile. Nothing calls this on a schedule yet; until a scheduled
 * trigger is added, a person or a job that holds the secret calls it. Calling it again is
 * safe: a reminder is recorded once.
 *
 * Nothing is sent to anyone, Qatom is not called and no money moves.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { evidenceStoreOrigin } from '#lib/server/backend/evidence.ts';
import { runSchedule } from '#lib/server/backend/schedule.ts';
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

	// The App's address: it is where sign-in lands, so it is the origin of OIDC_REDIRECT_URI.
	return json(await runSchedule(db, { now: new Date(), appOrigin: evidenceStoreOrigin(config) }));
};
