/**
 * POST /api/checkins: the endpoint Qatom calls each time one of a campaign's two catalog
 * items is bought. Track C owns this file.
 *
 * Qatom sends the item's declared inputs as JSON and the headers we configured on the item.
 * It never sends the payer's identity, which is why the reporter code is in the body. By the
 * time this runs the deposit HAS BEEN PAID, so refuse only what cannot be saved; anything
 * fixable should be saved as `incomplete` with a `statusReason`.
 *
 * What the answer says travels back through Qatom and becomes the agent's tool result.
 */
import { json } from '@sveltejs/kit';
import {
	CHECKIN_SECRET_HEADER,
	DEPOSIT_AMOUNT,
	formatAmount,
	parseCheckinBody,
	type CheckinAccepted,
	type CheckinRefused,
	type Deposit,
	type Entry
} from '@tejido/contracts';
import { findPartyByReporterCode, getMilestone, insertEntryWithDeposit } from '@tejido/db';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from './$types';

function refuse(status: number, body: Omit<CheckinRefused, 'accepted'>) {
	return json({ accepted: false, ...body } satisfies CheckinRefused, { status });
}

/** Compares in constant time, whatever the lengths. */
function sameSecret(given: string | null, expected: string): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return given !== null && timingSafeEqual(digest(given), digest(expected));
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { config, db } = locals.ctx;

	// 1. Only Qatom knows the shared secret.
	if (!sameSecret(request.headers.get(CHECKIN_SECRET_HEADER), config.CHECKIN_SHARED_SECRET)) {
		return refuse(401, { error: 'unauthorized', message: 'Missing or wrong check-in secret.' });
	}

	// 2. The body must satisfy the contract for the item that was bought.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return refuse(400, { error: 'invalid_body', message: 'The body is not JSON.' });
	}
	const parsed = parseCheckinBody(body);
	if (!parsed.ok) {
		return refuse(422, {
			error: 'invalid_inputs',
			message: `Refused: ${parsed.problems.map((p) => `${p.input} ${p.problem}`).join('; ')}`,
			problems: parsed.problems
		});
	}
	const { item, inputs } = parsed;

	// 3. The reporter code names the filer, and the milestone must be one of their campaign's.
	const party = await findPartyByReporterCode(db, inputs.reporter_code);
	if (!party) {
		return refuse(404, {
			error: 'unknown_reporter_code',
			message: 'Refused: that reporter code is not known. Use the code from your Tejido invite.'
		});
	}
	const milestone = await getMilestone(db, party.campaignId, inputs.milestone_id);
	if (!milestone) {
		return refuse(404, {
			error: 'unknown_milestone',
			message: `Refused: ${inputs.milestone_id} is not a milestone of this campaign.`
		});
	}

	// TODO(Track C): the rules a schema cannot express go here. May this party report on this
	// milestone? Does a `confirm` come from the named confirmer? Does a delivery have quantity
	// and unit (if not: status `incomplete`)? Is the slot open? Then advance the milestone state.

	// 4. Save the entry and the deposit that was paid with it.
	const now = new Date().toISOString();
	const entry = {
		id: `ent_${randomUUID()}`,
		campaignId: party.campaignId,
		milestoneId: milestone.id,
		partyId: party.id,
		item,
		inputs,
		status: 'filed',
		statusReason: null,
		payingWallet: null,
		twistId: null,
		filedAt: now,
		stampedAt: null,
		updatedAt: now
	} as Entry;
	const deposit: Deposit = {
		id: `dep_${randomUUID()}`,
		entryId: entry.id,
		amount: DEPOSIT_AMOUNT[item],
		refundedAt: null
	};
	await insertEntryWithDeposit(db, entry, deposit);

	// 5. Say what was accepted.
	const what = item === 'log_work' ? 'work log' : `milestone hit (${parsed.inputs.claim})`;
	return json({
		accepted: true,
		entry_id: entry.id,
		item,
		milestone_id: milestone.id,
		status: 'filed',
		deposit: formatAmount(deposit.amount),
		message: `Accepted: ${what} for "${milestone.title}" filed by ${party.name}. The ${formatAmount(deposit.amount)} deposit is returned when the milestone is confirmed.`
	} satisfies CheckinAccepted);
};
