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
import {
	countWorkLogs,
	findPartyByReporterCode,
	getMilestone,
	getParty,
	insertEntryAdvancingMilestone,
	insertEntryWithDeposit
} from '@tejido/db';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { decideCheckin, describeAccepted } from '#lib/server/backend/checkin-rules.ts';
import { evidenceStoreOrigin } from '#lib/server/backend/evidence.ts';
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

	// 4. The rules a schema cannot express: who may file this, what is missing, and whether
	//    the milestone moves on. They live in #lib/server/backend/checkin-rules.ts.
	const now = new Date().toISOString();
	const decision = decideCheckin({
		checkin: parsed,
		party,
		milestone,
		evidenceOrigin: evidenceStoreOrigin(config),
		now
	});
	if (!decision.allowed) {
		const { httpStatus, ...refusal } = decision.refusal;
		return refuse(httpStatus, refusal);
	}

	// 5. Save the entry and the deposit that was paid with it, and move the milestone on.
	const entry = {
		id: `ent_${randomUUID()}`,
		campaignId: party.campaignId,
		milestoneId: milestone.id,
		partyId: party.id,
		item,
		inputs,
		status: decision.status,
		statusReason: decision.statusReason,
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
	let advanced = false;
	let state = milestone.state;
	if (decision.advance) {
		advanced = await insertEntryAdvancingMilestone(db, entry, deposit, decision.advance);
		// If another entry moved the milestone first, read where it stands now.
		state = advanced
			? decision.advance.to
			: ((await getMilestone(db, party.campaignId, milestone.id))?.state ?? state);
	} else {
		await insertEntryWithDeposit(db, entry, deposit);
	}

	// 6. Say what was accepted and what is still owed.
	const confirmer = await getParty(db, milestone.confirmerPartyId);
	return json({
		accepted: true,
		entry_id: entry.id,
		item,
		milestone_id: milestone.id,
		status: decision.status,
		deposit: formatAmount(deposit.amount),
		message: describeAccepted({
			checkin: parsed,
			party,
			milestone,
			status: decision.status,
			owed: decision.owed,
			state,
			advanced,
			workLogNumber: await countWorkLogs(db, party.campaignId, milestone.id, party.id),
			confirmerName: confirmer?.name ?? 'its confirmer',
			deposit: deposit.amount
		})
	} satisfies CheckinAccepted);
};
