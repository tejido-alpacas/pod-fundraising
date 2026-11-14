// Calls the endpoint's own handler against a real, migrated, seeded database in a temporary
// folder. Nothing here reaches the network.
import { CHECKIN_SECRET_HEADER, DEPOSIT_AMOUNT, checkinResponseSchema } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	evidenceFiles,
	getEntry,
	getMilestone,
	listDeposits,
	listEntries,
	milestones
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

// The evidence store is the App, which is also where the sign-in callback is.
const APP = 'http://localhost:5174';

/** A file as the evidence upload would return it: stored under its own SHA-256. */
function evidence(extension: 'jpg' | 'png' | 'webp' | 'pdf', fill = 'a') {
	const sha256 = fill.repeat(64);
	return { url: `${APP}/evidence/${sha256}.${extension}`, sha256 };
}

const workLog = {
	reporter_code: contractor.reporterCode,
	milestone_id: 'm2-walls',
	summary: 'East wall at lintel height.',
	status: 'on_track',
	percent_complete: 50
};

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test.destroy());

async function post(
	body: unknown,
	headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }
) {
	const request = new Request('http://localhost/api/checkins', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const config = { CHECKIN_SHARED_SECRET: SECRET, OIDC_REDIRECT_URI: `${APP}/auth/callback` };
	const locals = { ctx: { db: test.db, config }, session: null };
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	return { status: response.status, body: checkinResponseSchema.parse(await response.json()) };
}

const entryCount = async () => (await listEntries(test.db, CAMPAIGN)).length;
const milestone = async (id: string) => (await getMilestone(test.db, CAMPAIGN, id))!;

/** Posts a check-in that must be accepted, and returns the answer with the saved entry. */
async function accepted(body: unknown) {
	const answer = await post(body);
	if (!answer.body.accepted) throw new Error(`expected acceptance: ${answer.body.message}`);
	expect(answer.status).toBe(200);
	const entry = (await getEntry(test.db, answer.body.entry_id))!;
	// The answer and the saved entry always agree.
	expect(entry.status).toBe(answer.body.status);
	return { body: answer.body, entry };
}

/** Posts a check-in that must be refused, and checks nothing was saved or moved. */
async function refused(body: Record<string, unknown> & { milestone_id: string }) {
	const before = await milestone(body.milestone_id);
	const answer = await post(body);
	if (answer.body.accepted) throw new Error('expected refusal');
	expect(await entryCount()).toBe(5);
	expect(await milestone(body.milestone_id)).toEqual(before);
	return { status: answer.status, body: answer.body };
}

/** Adds a milestone of a kind the fixtures do not have. */
async function addMilestone(values: Partial<typeof milestones.$inferInsert> & { id: string }) {
	await test.db.insert(milestones).values({
		campaignId: CAMPAIGN,
		position: 9,
		title: 'Extra milestone',
		description: '',
		kind: 'service',
		ownerPartyId: supplier.id,
		confirmerPartyId: headTeacher.id,
		dueDate: '2026-12-18',
		state: 'open',
		confirmedAt: null,
		...values
	});
}

const wallsClaim = {
	reporter_code: contractor.reporterCode,
	milestone_id: 'm2-walls',
	claim: 'completed',
	summary: 'Walls are at ring-beam height on all four sides.',
	photos: [evidence('jpg')]
};
const wallsConfirm = {
	reporter_code: headTeacher.reporterCode,
	milestone_id: 'm2-walls',
	claim: 'confirm',
	summary: 'I walked the site. The walls are at roof height on all four sides.'
};
const booksDelivery = {
	reporter_code: supplier.reporterCode,
	milestone_id: 'm3-books-delivered',
	claim: 'delivered',
	summary: 'Second shipment of reading books delivered and signed for.',
	quantity: 300,
	unit: 'books',
	photos: [evidence('jpg')]
};
const booksConfirm = {
	reporter_code: headTeacher.reporterCode,
	milestone_id: 'm3-books-delivered',
	claim: 'confirm',
	summary: 'I counted the boxes in the school office against the delivery note.'
};

describe('POST /api/checkins', () => {
	it('refuses a request without the secret header, and saves nothing', async () => {
		const { status, body } = await post(workLog, {});

		expect(status).toBe(401);
		expect(body).toMatchObject({ accepted: false, error: 'unauthorized' });
		expect(await entryCount()).toBe(5);
	});

	it('refuses a wrong secret', async () => {
		expect((await post(workLog, { [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect((await post(workLog, { [CHECKIN_SECRET_HEADER]: `${SECRET}x` })).status).toBe(401);
		expect(await entryCount()).toBe(5);
	});

	it('saves a work log with its 0.10 deposit and says what was accepted', async () => {
		const { status, body } = await post(workLog);

		expect(status).toBe(200);
		if (!body.accepted) throw new Error('expected acceptance');
		expect(body).toMatchObject({
			item: 'log_work',
			milestone_id: 'm2-walls',
			status: 'filed',
			deposit: '0.10'
		});

		expect(await getEntry(test.db, body.entry_id)).toMatchObject({
			campaignId: CAMPAIGN,
			milestoneId: 'm2-walls',
			partyId: contractor.id,
			item: 'log_work',
			inputs: workLog,
			status: 'filed',
			payingWallet: null,
			twistId: null
		});
		expect(await listDeposits(test.db, CAMPAIGN)).toContainEqual(
			expect.objectContaining({
				entryId: body.entry_id,
				amount: DEPOSIT_AMOUNT.log_work,
				refundedAt: null
			})
		);
	});

	it('saves a milestone hit with its 1.00 deposit', async () => {
		const { body, entry } = await accepted(wallsClaim);

		expect(body).toMatchObject({ item: 'milestone_hit', status: 'filed', deposit: '1.00' });
		expect(entry).toMatchObject({ item: 'milestone_hit', status: 'filed', statusReason: null });
		expect(await listDeposits(test.db, CAMPAIGN)).toContainEqual(
			expect.objectContaining({ entryId: body.entry_id, amount: DEPOSIT_AMOUNT.milestone_hit })
		);
	});

	it('refuses inputs that do not satisfy the contract, naming each one', async () => {
		const { status, body } = await post({ ...workLog, summary: '', percent_complete: 140 });

		expect(status).toBe(422);
		if (body.accepted) throw new Error('expected refusal');
		expect(body.error).toBe('invalid_inputs');
		expect(body.problems?.map((problem) => problem.input).sort()).toEqual([
			'percent_complete',
			'summary'
		]);
		expect(await entryCount()).toBe(5);
	});

	it('refuses a body that is not JSON', async () => {
		const { status, body } = await post('not json');
		expect(status).toBe(400);
		expect(body).toMatchObject({ accepted: false, error: 'invalid_body' });
	});

	it('refuses a reporter code it does not know', async () => {
		const { status, body } = await post({ ...workLog, reporter_code: 'rc_22222222222222222222' });
		expect(status).toBe(404);
		expect(body).toMatchObject({ accepted: false, error: 'unknown_reporter_code' });
		expect(await entryCount()).toBe(5);
	});

	it("refuses a milestone that is not in the party's campaign", async () => {
		const { status, body } = await post({ ...workLog, milestone_id: 'm9-roof' });
		expect(status).toBe(404);
		expect(body).toMatchObject({ accepted: false, error: 'unknown_milestone' });
		expect(await entryCount()).toBe(5);
	});
});

describe('who may report on a milestone', () => {
	it("refuses a work log on another party's milestone", async () => {
		const { status, body } = await refused({ ...workLog, reporter_code: supplier.reporterCode });

		expect(status).toBe(422);
		expect(body.error).toBe('invalid_inputs');
		expect(body.problems?.map((problem) => problem.input)).toEqual(['milestone_id']);
		expect(body.message).toMatch(/^Refused: .*not your milestone/);
	});

	it("refuses a claim on another party's milestone", async () => {
		const { status, body } = await refused({ ...wallsClaim, reporter_code: supplier.reporterCode });

		expect(status).toBe(422);
		expect(body.problems?.map((problem) => problem.input)).toEqual(['milestone_id']);
	});

	it('refuses a work log from the confirmer', async () => {
		const { body } = await refused({ ...workLog, reporter_code: headTeacher.reporterCode });
		expect(body.problems?.map((problem) => problem.input)).toEqual(['milestone_id']);
	});

	it('refuses a claim from the confirmer, and points them at "confirm"', async () => {
		const { status, body } = await refused({
			...wallsClaim,
			reporter_code: headTeacher.reporterCode
		});

		expect(status).toBe(422);
		expect(body.problems?.map((problem) => problem.input)).toEqual(['claim']);
		expect(body.message).toContain('"confirm"');
	});

	it('refuses a confirmation from the party who owes the milestone', async () => {
		const { status, body } = await refused({
			...booksConfirm,
			reporter_code: supplier.reporterCode
		});

		expect(status).toBe(422);
		expect(body.error).toBe('invalid_inputs');
		expect(body.problems?.map((problem) => problem.input)).toEqual(['claim']);
		expect(body.message).toContain('cannot confirm');
	});

	it('refuses a confirmation from a party who is not the named confirmer', async () => {
		const { status, body } = await refused({
			...booksConfirm,
			reporter_code: contractor.reporterCode
		});

		expect(status).toBe(422);
		expect(body.problems?.map((problem) => problem.input)).toEqual(['claim']);
		expect(body.message).toContain('only the confirmer');
	});

	it('refuses a confirmation when one party is both owner and confirmer', async () => {
		await addMilestone({
			id: 'm4-self-signed',
			state: 'claimed',
			ownerPartyId: supplier.id,
			confirmerPartyId: supplier.id
		});

		const { body } = await refused({
			...booksConfirm,
			milestone_id: 'm4-self-signed',
			reporter_code: supplier.reporterCode
		});
		expect(body.message).toContain('cannot confirm');
	});
});

describe('milestone states', () => {
	it('moves an open milestone to claimed when its owner claims it', async () => {
		const { body } = await accepted(wallsClaim);

		expect(await milestone('m2-walls')).toMatchObject({ state: 'claimed', confirmedAt: null });
		expect(body.message).toContain(`awaits confirmation by ${headTeacher.name}`);
		expect(body.message).toContain('returned when the milestone is confirmed');
	});

	it('moves a claimed milestone to confirmed when its named confirmer confirms', async () => {
		const { body, entry } = await accepted(booksConfirm);

		expect(body.status).toBe('filed');
		expect(await milestone('m3-books-delivered')).toMatchObject({
			state: 'confirmed_independent',
			confirmedAt: entry.filedAt
		});
		expect(body.message).toContain('now confirmed independently');
	});

	it('takes a milestone from open to claimed to confirmed, by two different parties', async () => {
		const claim = await accepted(wallsClaim);
		const confirmation = await accepted(wallsConfirm);

		expect(claim.entry.partyId).toBe(contractor.id);
		expect(confirmation.entry.partyId).toBe(headTeacher.id);
		expect((await milestone('m2-walls')).state).toBe('confirmed_independent');
	});

	it('does not confirm a milestone nobody has claimed, and saves the entry as incomplete', async () => {
		const { body, entry } = await accepted(wallsConfirm);

		expect(body.status).toBe('incomplete');
		expect(entry.statusReason).toContain('Nothing has been claimed');
		expect(body.message).toContain('Confirm again once');
		expect(await milestone('m2-walls')).toMatchObject({ state: 'open', confirmedAt: null });
	});

	it('leaves a claimed milestone claimed when its owner claims again', async () => {
		const { body } = await accepted(booksDelivery);

		expect(body.status).toBe('filed');
		expect((await milestone('m3-books-delivered')).state).toBe('claimed');
	});

	it('leaves a confirmed milestone as it was, whatever is filed on it', async () => {
		const before = await milestone('m1-foundation');

		const claim = await accepted({ ...wallsClaim, milestone_id: 'm1-foundation' });
		const confirmation = await accepted({ ...wallsConfirm, milestone_id: 'm1-foundation' });

		expect(claim.body.message).toContain('already confirmed');
		expect(confirmation.body.message).toContain('already confirmed');
		expect(await milestone('m1-foundation')).toEqual(before);
	});

	it('does not move a milestone for a work log', async () => {
		await accepted(workLog);
		expect((await milestone('m2-walls')).state).toBe('open');
	});

	it('moves the milestone even when the claim is incomplete', async () => {
		const { body } = await accepted({ ...wallsClaim, photos: undefined });

		expect(body.status).toBe('incomplete');
		expect((await milestone('m2-walls')).state).toBe('claimed');
	});
});

describe('what makes an entry incomplete', () => {
	it('numbers the work log and says when the milestone is due', async () => {
		const { body } = await accepted(workLog);

		// The fixtures hold two work logs by the contractor on this milestone.
		expect(body.message).toContain('work log 3 for "Walls up to roof height"');
		expect(body.message).toContain('50% complete');
		expect(body.message).toContain('due 2026-11-27');
	});

	it('wants a percent complete on a construction work log', async () => {
		const { body, entry } = await accepted({ ...workLog, percent_complete: undefined });

		expect(body.status).toBe('incomplete');
		expect(entry.statusReason).toBe(
			'A work log on a construction milestone needs a percent complete.'
		);
		expect(body.message).toContain('Still owed: A work log on a construction milestone');
		expect(body.message).toContain('you do not pay again');
	});

	it('needs only a summary when work is blocked', async () => {
		const { body } = await accepted({
			reporter_code: contractor.reporterCode,
			milestone_id: 'm2-walls',
			summary: 'No blocks on site: the ferry did not run this week.',
			status: 'blocked'
		});
		expect(body.status).toBe('filed');
	});

	it('does not want a percent complete on a goods delivery work log', async () => {
		const { body } = await accepted({
			reporter_code: supplier.reporterCode,
			milestone_id: 'm3-books-delivered',
			summary: 'Second shipment has left the warehouse.'
		});
		expect(body.status).toBe('filed');
	});

	it('wants a quantity and a unit on a delivery', async () => {
		for (const missing of [{ quantity: undefined }, { unit: undefined }, { unit: '  ' }]) {
			const { body, entry } = await accepted({ ...booksDelivery, ...missing });

			expect(body.status).toBe('incomplete');
			expect(entry.statusReason).toBe('A delivery needs a quantity and a unit.');
		}
	});

	it('wants a photo on a construction or delivery claim, and a document is not one', async () => {
		const noEvidence = await accepted({ ...booksDelivery, photos: undefined });
		const onlyDocument = await accepted({ ...wallsClaim, photos: [evidence('pdf')] });

		expect(noEvidence.entry).toMatchObject({
			status: 'incomplete',
			statusReason: 'A goods delivery claim needs at least one photo.'
		});
		expect(onlyDocument.entry).toMatchObject({
			status: 'incomplete',
			statusReason: 'A construction claim needs at least one photo.'
		});
	});

	it('accepts a photo and a document together on a construction claim', async () => {
		const { body } = await accepted({
			...wallsClaim,
			photos: [evidence('png', 'b'), evidence('pdf', 'c')]
		});
		expect(body.status).toBe('filed');
	});

	it('wants the claim that fits the kind of milestone', async () => {
		const { body, entry } = await accepted({ ...wallsClaim, claim: 'delivered' });

		expect(body.status).toBe('incomplete');
		expect(entry.statusReason).toBe(
			'A construction milestone is claimed with "completed", not "delivered".'
		);
	});

	describe('on a funds handover', () => {
		const fees = {
			reporter_code: supplier.reporterCode,
			milestone_id: 'm4-fees',
			claim: 'funds_spent',
			summary: 'Term fees paid to the school registrar.',
			amount_spent: 450,
			photos: [evidence('pdf')]
		};
		beforeEach(() => addMilestone({ id: 'm4-fees', kind: 'funds_handover' }));

		it('files a claim with the amount spent and a receipt', async () => {
			const { body } = await accepted(fees);

			expect(body.status).toBe('filed');
			expect((await milestone('m4-fees')).state).toBe('claimed');
		});

		it('wants the amount spent', async () => {
			const { entry } = await accepted({ ...fees, amount_spent: undefined });
			expect(entry).toMatchObject({
				status: 'incomplete',
				statusReason: 'A funds handover needs the amount spent.'
			});
		});

		it('wants a receipt', async () => {
			const { entry } = await accepted({ ...fees, photos: [] });
			expect(entry).toMatchObject({
				status: 'incomplete',
				statusReason: 'A funds handover needs a receipt, uploaded as a document (PDF).'
			});
		});

		it('takes documents only: a picture makes the entry incomplete', async () => {
			const { entry } = await accepted({
				...fees,
				photos: [evidence('pdf'), evidence('jpg', 'b')]
			});
			expect(entry).toMatchObject({
				status: 'incomplete',
				statusReason:
					'A funds handover milestone takes documents only (PDF), no photos: item 2 in photos is a picture.'
			});
		});
	});

	describe('on a service', () => {
		const service = {
			reporter_code: supplier.reporterCode,
			milestone_id: 'm4-tutoring',
			claim: 'completed',
			summary: 'Twelve weeks of reading support delivered.',
			photos: [evidence('pdf')]
		};
		beforeEach(() => addMilestone({ id: 'm4-tutoring', kind: 'service' }));

		it('files a claim with a document', async () => {
			expect((await accepted(service)).body.status).toBe('filed');
		});

		it('wants a document on the claim', async () => {
			const { entry } = await accepted({ ...service, photos: undefined });
			expect(entry).toMatchObject({
				status: 'incomplete',
				statusReason: 'A service claim needs at least one document (PDF).'
			});
		});

		it('takes no pictures, on a work log or a confirmation either', async () => {
			const log = await accepted({
				reporter_code: supplier.reporterCode,
				milestone_id: 'm4-tutoring',
				summary: 'Week three of reading support.',
				photos: [evidence('webp'), evidence('png', 'b')]
			});
			await accepted(service);
			const confirmation = await accepted({
				...booksConfirm,
				milestone_id: 'm4-tutoring',
				photos: [evidence('jpg')]
			});

			expect(log.entry).toMatchObject({
				status: 'incomplete',
				statusReason:
					'A service milestone takes documents only (PDF), no photos: items 1 and 2 in photos are pictures.'
			});
			expect(confirmation.entry.status).toBe('incomplete');
			// The confirmer signed it off all the same.
			expect((await milestone('m4-tutoring')).state).toBe('confirmed_independent');
		});
	});
});

describe('files marked not public', () => {
	/** Marks a stored file not public, as its uploader would on the upload page. */
	async function markNotPublic(sha256: string, partyId: string) {
		await test.db.insert(evidenceFiles).values({
			sha256,
			uploadedByPartyId: partyId,
			visibility: 'not_public',
			notPublicKind: 'Site plan',
			notPublicReason: 'It shows where the neighbours live.',
			createdAt: '2026-11-14T08:00:00.000Z',
			updatedAt: '2026-11-14T08:00:00.000Z'
		});
	}

	it('does not let a photo donors cannot see stand as the photo a claim needs', async () => {
		await markNotPublic('a'.repeat(64), contractor.id);

		const { body, entry } = await accepted(wallsClaim);

		expect(body.status).toBe('incomplete');
		expect(entry.statusReason).toBe(
			'A construction claim needs at least one photo that donors can see. Every photo attached is marked not public.'
		);
		// The claim is still saved, with its file, and still moves the milestone.
		expect(entry.inputs.photos).toEqual(wallsClaim.photos);
		expect((await milestone('m2-walls')).state).toBe('claimed');
	});

	it('files a claim that has a photo donors can see beside a not-public one', async () => {
		await markNotPublic('a'.repeat(64), contractor.id);

		const { body } = await accepted({
			...wallsClaim,
			photos: [evidence('jpg', 'a'), evidence('jpg', 'b')]
		});

		expect(body.status).toBe('filed');
	});

	it('does not let a not-public document stand as the document a claim needs', async () => {
		await addMilestone({ id: 'm4-tutoring', kind: 'service' });
		await markNotPublic('a'.repeat(64), supplier.id);

		const { entry } = await accepted({
			reporter_code: supplier.reporterCode,
			milestone_id: 'm4-tutoring',
			claim: 'completed',
			summary: 'Twelve weeks of reading support delivered.',
			photos: [evidence('pdf', 'a')]
		});

		expect(entry).toMatchObject({
			status: 'incomplete',
			statusReason:
				'A service claim needs at least one document (PDF) that donors can see. Every document attached is marked not public.'
		});
	});

	it('takes a not-public file on a work log, which owes no photo', async () => {
		await markNotPublic('a'.repeat(64), contractor.id);

		const { body } = await accepted({ ...workLog, photos: [evidence('jpg', 'a')] });

		expect(body.status).toBe('filed');
	});
});

describe('the photos list', () => {
	const ours = evidence('jpg');

	it('files an entry whose files all come from our evidence store', async () => {
		const { body, entry } = await accepted({
			...workLog,
			photos: [ours, { ...evidence('pdf', 'b'), caption: 'Delivery note' }]
		});

		expect(body.status).toBe('filed');
		expect(entry.inputs.photos).toHaveLength(2);
	});

	it('marks an entry incomplete when a URL is not in our evidence store', async () => {
		const elsewhere = [
			`https://images.example/evidence/${ours.sha256}.jpg`,
			`${APP}/uploads/${ours.sha256}.jpg`,
			`${APP}/evidence/${ours.sha256}.gif`,
			`${APP}/evidence/site-photo.jpg`,
			`${ours.url}?size=large`,
			`http://localhost:5173/evidence/${ours.sha256}.jpg`
		];
		for (const url of elsewhere) {
			const { body, entry } = await accepted({ ...workLog, photos: [ours, { ...ours, url }] });

			expect(body.status).toBe('incomplete');
			expect(entry.statusReason).toContain(
				'Every file must come from the Tejido evidence upload: item 2 in photos does not.'
			);
			// The inputs are kept exactly as they were filed.
			expect(entry.inputs.photos?.[1]?.url).toBe(url);
		}
	});

	it('marks an entry incomplete when a hash is not the hash of the stored file', async () => {
		const { body, entry } = await accepted({
			...workLog,
			photos: [{ url: ours.url, sha256: 'b'.repeat(64) }]
		});

		expect(body.status).toBe('incomplete');
		expect(entry.statusReason).toBe(
			'The SHA-256 given for item 1 in photos is not the hash of the uploaded file.'
		);
	});

	it('does not count a file from elsewhere as the photo a claim needs', async () => {
		const { entry } = await accepted({
			...wallsClaim,
			photos: [{ ...ours, url: `https://images.example/${ours.sha256}.jpg` }]
		});

		expect(entry.status).toBe('incomplete');
		expect(entry.statusReason).toContain('A construction claim needs at least one photo.');
		expect(entry.statusReason).toContain('Every file must come from the Tejido evidence upload');
	});

	it('refuses more than ten files, or a hash that is not 64 hexadecimal characters', async () => {
		const eleven = await refused({ ...workLog, photos: Array.from({ length: 11 }, () => ours) });
		const badHash = await refused({ ...workLog, photos: [{ url: ours.url, sha256: 'abc' }] });

		expect(eleven).toMatchObject({ status: 422, body: { error: 'invalid_inputs' } });
		expect(badHash.body.problems?.map((problem) => problem.input)).toEqual(['photos.0.sha256']);
	});
});
