/**
 * POST /api/donations/<amount>: the endpoint Qatom calls each time one of Tejido's donation
 * items has been paid for. Track C owns this file.
 *
 * Campaigns share the donation items: one catalog item per amount on Tejido's merchant
 * account. Each item's external endpoint is this address with its own price at the end
 * (`/api/donations/5` for the 5 item), and its one declared input is `campaign_id`.
 *
 *   - WHICH CAMPAIGN comes from the body: the item's declared input.
 *   - HOW MUCH comes from the address, never from the body. The address is set on the item by
 *     its owner; a buyer can type any input, and a donation of 5 must not be recorded as 50.
 *     It is a whole number of USD-TDN, at least 1.
 *   - WHICH PAYMENT comes from the `X-Qatom-Transaction-Id` header Qatom sends with a
 *     dispatch (its API document, GET /v4/catalog/purchases/{transaction_id}). Only its
 *     SHA-256 is kept, so the same payment is never counted twice and the id is not stored.
 *
 * By the time this runs the donor HAS PAID, so it refuses only what cannot be saved: a call
 * without the secret, an address that gives no amount, and a campaign that does not exist.
 * A call with no transaction id is still saved; it just cannot be recognised if repeated.
 *
 * No donor is identified: nothing here reads or stores a name, an email or a wallet. Nothing
 * is logged, nothing calls Qatom and no money moves.
 */
import { json } from '@sveltejs/kit';
import { CHECKIN_SECRET_HEADER, donationInputSchema, formatAmount } from '@tejido/contracts';
import { getCampaign, recordDonation } from '@tejido/db';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { donationAmountOf } from '#lib/server/backend/donation-items.ts';
import type { RequestHandler } from './$types';

/** Qatom sets this itself on every dispatch; an item's own headers cannot use the name. */
const TRANSACTION_ID_HEADER = 'X-Qatom-Transaction-Id';

/** Compares in constant time, whatever the lengths. As in the check-in endpoint. */
function sameSecret(given: string | null, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return given !== null && timingSafeEqual(digest(given), digest(expected));
}

function refuse(status: number, error: string, message: string) {
	return json({ accepted: false, error, message }, { status });
}

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const { config, db } = locals.ctx;

	// 1. Only Qatom knows the shared secret.
	if (!sameSecret(request.headers.get(CHECKIN_SECRET_HEADER), config.CHECKIN_SHARED_SECRET)) {
		return refuse(401, 'unauthorized', 'Missing or wrong check-in secret.');
	}

	// 2. The address says how much the item costs.
	const amount = donationAmountOf(params.amount);
	if (amount === null) {
		return refuse(
			404,
			'unknown_amount',
			'Refused: this address names no donation amount. A donation item must call /api/donations/ followed by its price as a whole number, for example /api/donations/5.'
		);
	}

	// 3. The body says which campaign.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return refuse(400, 'invalid_body', 'The body is not JSON.');
	}
	const inputs = donationInputSchema.safeParse(body);
	if (!inputs.success) {
		return refuse(422, 'invalid_inputs', 'Refused: campaign_id is missing or is not an id.');
	}
	const campaign = await getCampaign(db, inputs.data.campaign_id);
	if (!campaign) {
		return refuse(
			404,
			'unknown_campaign',
			'Refused: there is no campaign with that id, so this donation could not be recorded.'
		);
	}

	// 4. Save it once per payment, and move the campaign to funded if its goal is now met.
	const transactionId = request.headers.get(TRANSACTION_ID_HEADER)?.trim();
	const { recorded, donationId } = await recordDonation(db, {
		id: `don_${randomUUID()}`,
		campaignId: campaign.id,
		amount,
		paymentDigest: transactionId ? createHash('sha256').update(transactionId).digest('hex') : null,
		receivedAt: new Date().toISOString()
	});

	const given = `${formatAmount(amount)} USD-TDN`;
	return json({
		accepted: true,
		donation_id: donationId,
		campaign_id: campaign.id,
		amount: formatAmount(amount),
		/** True when this payment had already been recorded: nothing was added. */
		duplicate: !recorded,
		message: recorded
			? `Thank you. Your donation of ${given} to "${campaign.title}" is recorded.`
			: `This donation of ${given} to "${campaign.title}" was already recorded. It is counted once.`
	});
};
