/**
 * POST /api/refunds: sends back the deposits paid on one confirmed milestone. Track C owns
 * this file.
 *
 * The body names the milestone: `{ "campaign_id": "...", "milestone_id": "..." }`. The caller
 * must send the same shared secret as the check-in endpoint, in the same header.
 *
 * The answer lists what was sent, and what was skipped and why. Calling it again is safe: a
 * deposit is never sent twice. The rules are in #lib/server/backend/refunds.ts.
 *
 * Nothing calls this automatically yet. THIS ENDPOINT MOVES MONEY when it is called with real
 * configuration.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER, idSchema } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { refundMilestone } from '#lib/server/backend/refunds.ts';
import type { RequestHandler } from './$types';

function refuse(status: number, error: string, message: string) {
	return json({ refunded: false, error, message }, { status });
}

/** Compares in constant time, whatever the lengths. The same check as /api/checkins. */
function sameSecret(given: string | null, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return given !== null && timingSafeEqual(digest(given), digest(expected));
}

function readId(body: unknown, name: string): string | null {
	if (typeof body !== 'object' || body === null) return null;
	const parsed = idSchema.safeParse((body as Record<string, unknown>)[name]);
	return parsed.success ? parsed.data : null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { config, db, qatom } = locals.ctx;

	if (!sameSecret(request.headers.get(CHECKIN_SECRET_HEADER), config.CHECKIN_SHARED_SECRET)) {
		return refuse(401, 'unauthorized', 'Missing or wrong secret.');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return refuse(400, 'invalid_body', 'The body is not JSON.');
	}
	const campaignId = readId(body, 'campaign_id');
	const milestoneId = readId(body, 'milestone_id');
	if (campaignId === null || milestoneId === null) {
		return refuse(
			422,
			'invalid_inputs',
			'Refused: the body must name one milestone as { "campaign_id": "...", "milestone_id": "..." }.'
		);
	}

	// Refunds are paid by Tejido's merchant account. No person's token is involved.
	const result = await refundMilestone({ db, account: qatom.account, campaignId, milestoneId });
	if (!result.ok) return refuse(result.httpStatus, result.error, result.message);

	return json({ refunded: result.report.sent.length > 0, ...result.report });
};
