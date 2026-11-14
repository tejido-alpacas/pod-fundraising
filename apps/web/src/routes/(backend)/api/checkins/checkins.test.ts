// Calls the endpoint's own handler against a real, migrated, seeded database in a temporary
// folder. Nothing here reaches the network.
import { CHECKIN_SECRET_HEADER, DEPOSIT_AMOUNT, checkinResponseSchema } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { getEntry, listDeposits, listEntries } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;

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
	const locals = { ctx: { db: test.db, config: { CHECKIN_SHARED_SECRET: SECRET } }, session: null };
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	return { status: response.status, body: checkinResponseSchema.parse(await response.json()) };
}

const entryCount = async () => (await listEntries(test.db, CAMPAIGN)).length;

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
		const { body } = await post({
			reporter_code: contractor.reporterCode,
			milestone_id: 'm2-walls',
			claim: 'completed',
			summary: 'Walls are at ring-beam height on all four sides.'
		});

		if (!body.accepted) throw new Error('expected acceptance');
		expect(body).toMatchObject({ item: 'milestone_hit', deposit: '1.00' });
		expect((await getEntry(test.db, body.entry_id))?.item).toBe('milestone_hit');
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
