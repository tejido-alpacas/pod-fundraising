/**
 * POST /api/provisioning: creates one campaign's two catalog items in Qatom and stores their
 * commodity ids on the campaign. Track C owns this file. The rules, and how it is made safe
 * to call twice, are in #lib/server/backend/provisioning.ts.
 *
 * The body names the campaign and the digital quantity the prices are in:
 * `{ "campaign_id": "...", "dq": "..." }`. `dq` is the hash Qatom lists for USD-TDN
 * (GET {PAYMENT_API_URL}/v4/dq); there is no configuration value for it yet.
 *
 * Not for the public: the caller must send the same shared secret as the check-in endpoint,
 * in the same header.
 *
 * THIS IS THE ONLY TRIGGER. "When a campaign reaches its goal" does not exist in the code
 * yet (donations are not modelled), so nothing calls this automatically: a person or a job
 * that holds the secret does.
 *
 * Qatom is told to call the check-in endpoint on the same origin this request arrived at, so
 * call it on the deployed site. THIS ENDPOINT CREATES REAL ITEMS IN QATOM when it is called
 * with real configuration.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER, idSchema } from '@tejido/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { provisionCampaignItems } from '#lib/server/backend/provisioning.ts';
import type { RequestHandler } from './$types';

function refuse(status: number, error: string, message: string) {
	return json({ provisioned: false, error, message }, { status });
}

/** Compares in constant time, whatever the lengths. The same check as /api/checkins. */
function sameSecret(given: string | null, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return given !== null && timingSafeEqual(digest(given), digest(expected));
}

function readField(body: unknown, name: string): unknown {
	return typeof body === 'object' && body !== null
		? (body as Record<string, unknown>)[name]
		: undefined;
}

export const POST: RequestHandler = async ({ request, url, locals }) => {
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
	const campaignId = idSchema.safeParse(readField(body, 'campaign_id'));
	const dq = readField(body, 'dq');
	if (!campaignId.success || typeof dq !== 'string' || !/^[0-9a-zA-Z]+$/.test(dq)) {
		return refuse(
			422,
			'invalid_inputs',
			'Refused: the body must be { "campaign_id": "...", "dq": "..." }, where dq is the hash of the digital quantity the items are priced in.'
		);
	}

	// The items are created by Tejido's merchant account. No person's token is involved.
	const result = await provisionCampaignItems({
		db,
		account: qatom.account,
		campaignId: campaignId.data,
		dq,
		checkinEndpoint: new URL('/api/checkins', url.origin).href,
		checkinSecret: config.CHECKIN_SHARED_SECRET
	});
	if (!result.ok) return refuse(result.httpStatus, result.error, result.message);

	return json(
		{ provisioned: result.provisioned, campaign_id: result.campaignId, items: result.items },
		{ status: result.provisioned ? 200 : 502 }
	);
};
