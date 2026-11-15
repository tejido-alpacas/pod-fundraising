// Calls the endpoint's own handler, the way Qatom would, against a real, migrated, seeded
// database. Nothing here reaches the network.
import { CHECKIN_SECRET_HEADER, donationInputJsonSchema } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, getCampaign, getFundingSummary, listDonations } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const CAMPAIGN = fixtures.campaign.id;
const TRANSACTION = '5f0c7c1e-8a4b-4d2f-9c61-3b7e2a9d4f10';
const OTHER_TRANSACTION = '0b7e2a9d-4f10-4d2f-9c61-5f0c7c1e8a4b';

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	await test.db
		.update(campaigns)
		.set({ status: 'funding', fundingGoal: 30_000 })
		.where(eq(campaigns.id, CAMPAIGN));
});
afterEach(() => test.destroy());

/** One call as Qatom makes it after a sale: the item's inputs, its secret header, the sale's id. */
async function post(
	amount: string,
	body: unknown = { campaign_id: CAMPAIGN },
	headers: Record<string, string> = {
		[CHECKIN_SECRET_HEADER]: SECRET,
		'X-Qatom-Transaction-Id': TRANSACTION
	}
) {
	const request = new Request(`http://localhost/api/donations/${amount}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const locals = { ctx: { db: test.db, config: { CHECKIN_SHARED_SECRET: SECRET } }, session: null };
	const response = await POST({
		request,
		params: { amount },
		locals
	} as unknown as Parameters<typeof POST>[0]);
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const saved = () => listDonations(test.db, CAMPAIGN);
const campaign = async () => (await getCampaign(test.db, CAMPAIGN))!;

describe('POST /api/donations/<amount>', () => {
	it('records a donation: the campaign from the body, the amount from the address', async () => {
		const answer = await post('5');

		expect(answer.status).toBe(200);
		const [row] = await saved();
		expect(answer.body).toEqual({
			accepted: true,
			donation_id: row!.id,
			campaign_id: CAMPAIGN,
			amount: '5.00',
			duplicate: false,
			message: `Thank you. Your donation of 5.00 USD-TDN to "${fixtures.campaign.title}" is recorded.`
		});
		expect(row).toMatchObject({ campaignId: CAMPAIGN, amount: 5000 });
	});

	it('shows on the campaign page: amount raised, number of donations and the goal', async () => {
		await post('5');
		await post('25', undefined, {
			[CHECKIN_SECRET_HEADER]: SECRET,
			'X-Qatom-Transaction-Id': OTHER_TRANSACTION
		});

		expect(await getFundingSummary(test.db, await campaign())).toMatchObject({
			state: 'known',
			goal: 30_000,
			raised: 30_000,
			donations: 2,
			goalMet: true
		});
	});

	it('moves the campaign from funding to funded with the donation that reaches the goal', async () => {
		await post('25');
		expect((await campaign()).status).toBe('funding');

		await post('5', undefined, {
			[CHECKIN_SECRET_HEADER]: SECRET,
			'X-Qatom-Transaction-Id': OTHER_TRANSACTION
		});
		expect((await campaign()).status).toBe('funded');
	});

	it('counts a payment once when Qatom calls twice for it', async () => {
		const first = await post('10');
		const again = await post('10');

		expect(again.status).toBe(200);
		expect(again.body).toMatchObject({
			accepted: true,
			duplicate: true,
			donation_id: first.body.donation_id
		});
		expect(await saved()).toHaveLength(1);
	});

	it('keeps only a SHA-256 of the transaction id, never the id', async () => {
		await post('5');
		const [row] = await saved();

		expect(row!.paymentDigest).toBe(createHash('sha256').update(TRANSACTION).digest('hex'));
		expect(JSON.stringify(await saved())).not.toContain(TRANSACTION);
	});

	it('still records a paid donation that came with no transaction id, each time it is called', async () => {
		const headers = { [CHECKIN_SECRET_HEADER]: SECRET };
		const first = await post('5', undefined, headers);
		await post('5', undefined, headers);

		expect(first.body).toMatchObject({ accepted: true, duplicate: false });
		expect(await saved()).toHaveLength(2);
		expect((await saved()).map((row) => row.paymentDigest)).toEqual([null, null]);
	});

	it('ignores an amount, a name or a wallet typed into the body: nothing of them is saved', async () => {
		await post('5', {
			campaign_id: CAMPAIGN,
			amount: 50,
			donor: 'Ada Example',
			wallet: 'ada.micro.biz.todaq.net'
		});
		const [row] = await saved();

		expect(row!.amount).toBe(5000);
		expect(JSON.stringify(row)).not.toMatch(/Ada|todaq/);
	});

	it.each([
		['no secret', {}],
		['a wrong secret', { [CHECKIN_SECRET_HEADER]: 'not-the-secret-not-the-secret-not' }]
	])('refuses a call with %s and saves nothing', async (_name, headers) => {
		const answer = await post('5', undefined, headers);

		expect(answer.status).toBe(401);
		expect(answer.body).toMatchObject({ accepted: false, error: 'unauthorized' });
		expect(await saved()).toEqual([]);
	});

	it.each(['0', '05', '-5', '5.5', '0.5', 'five', '5e3', '1000000', ' 5'])(
		'refuses the address /api/donations/%s: it names no amount',
		async (amount) => {
			const answer = await post(amount);

			expect(answer.status).toBe(404);
			expect(answer.body).toMatchObject({ accepted: false, error: 'unknown_amount' });
			expect(await saved()).toEqual([]);
		}
	);

	it('refuses a body that is not JSON', async () => {
		const answer = await post('5', 'campaign_id=cmp');

		expect(answer.status).toBe(400);
		expect(answer.body).toMatchObject({ accepted: false, error: 'invalid_body' });
	});

	it.each([{}, { campaign_id: '' }, { campaign_id: 7 }, { campaign: CAMPAIGN }, null])(
		'refuses inputs without a campaign id: %j',
		async (body) => {
			const answer = await post('5', body);

			expect(answer.status).toBe(422);
			expect(answer.body).toMatchObject({ accepted: false, error: 'invalid_inputs' });
			expect(await saved()).toEqual([]);
		}
	);

	it('refuses a campaign that does not exist, and says so', async () => {
		const answer = await post('5', { campaign_id: 'cmp_nobody' });

		expect(answer.status).toBe(404);
		expect(answer.body).toMatchObject({ accepted: false, error: 'unknown_campaign' });
	});

	it('never puts the secret or the transaction id in an answer', async () => {
		const answers = [await post('5'), await post('5'), await post('five'), await post('5', {})];

		for (const answer of answers) {
			expect(JSON.stringify(answer.body)).not.toContain(SECRET);
			expect(JSON.stringify(answer.body)).not.toContain(TRANSACTION);
		}
	});
});

describe('the schema to enter on a donation item in Qatom', () => {
	it('declares one required input, the campaign id, and nothing about the donor or the amount', () => {
		expect(donationInputJsonSchema()).toEqual({
			type: 'object',
			properties: {
				campaign_id: {
					type: 'string',
					minLength: 1,
					maxLength: 100,
					description: 'The Tejido campaign this donation is for.'
				}
			},
			required: ['campaign_id']
		});
	});
});
