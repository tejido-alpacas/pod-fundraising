// Runs the funding refresh through its route against a real, migrated, seeded database, with
// the real merchant account client. Nothing here reaches the network: `fetch` is replaced, in
// this file only, by a stub that answers Qatom's token, catalog listing and ledger endpoints
// from prepared data. Then the two page loads are called, to see what a page is given.
import { CHECKIN_SECRET_HEADER, type CampaignStatus } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaignFunding, campaigns, getCampaign, getFundingSummary } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FundingRefreshSummary } from '#lib/server/backend/funding.ts';
import { load as loadOverview } from '../../../(campaign-site)/campaigns/[campaignId]/+page.server.ts';
import { load as loadHome } from '../../../+page.server.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const API = 'https://pay.stage.m.todaq.net';
const CAMPAIGN = fixtures.campaign.id;
const GOAL = 5000;
/** The donation item's commodity id, and the hash Qatom's catalog gives for it. */
const DONATION_ID = 3154;
const DONATION_HASH = 'donationhash333';
/** The twin that owns the donation commodity: where donations are paid to. */
const DONATION_TWIN = 'donations.micro.biz.todaq.net';
const DONOR_A = 'donor-a.micro.biz.todaq.net';
const DONOR_B = 'donor-b.micro.biz.todaq.net';

interface LedgerAnswer {
	rows: Record<string, unknown>[];
	/** What the ledger says of its commodity. The owning twin is named unless a test removes it. */
	commodity?: Record<string, unknown>;
}
type Ledger = LedgerAnswer | { status: number } | Error;
/** What the catalog listing answers for a commodity id: its hash, or a failure. */
type Listing = string | { status: number } | Error;

let test: TestDatabase;
let ledgers: Record<string, Ledger>;
/** A commodity id that is not here is one Qatom does not know: the listing comes back empty. */
let catalog: Record<number, Listing>;
let requests: { method: string; url: string; authorization: string | undefined }[];

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	ledgers = {};
	catalog = { [DONATION_ID]: DONATION_HASH };
	requests = [];
	vi.stubGlobal('fetch', (url: string | URL, init: RequestInit = {}) => {
		const address = String(url);
		requests.push({
			method: init.method ?? 'GET',
			url: address,
			authorization: (init.headers as Record<string, string>).authorization
		});
		const answer = (body: unknown, status = 200) =>
			Promise.resolve(new Response(JSON.stringify(body), { status }));

		if (address === `${API}/v4/account/oauth/token`) {
			return answer({
				access_token: 'account-token',
				expires_at: Math.floor(Date.now() / 1000) + 3600
			});
		}
		const { pathname, searchParams } = new URL(address);
		if (pathname === '/v4/catalog/items') {
			const commodityId = Number(searchParams.get('commodity_id'));
			const listing = catalog[commodityId];
			if (listing instanceof Error) return Promise.reject(listing);
			if (typeof listing === 'object') {
				return answer({ error: 'Something went wrong', status: listing.status }, listing.status);
			}
			const items =
				listing === undefined
					? []
					: [{ id: 42, commodity_id: commodityId, commodity_hash: listing, active: true }];
			return answer({ items, total: items.length, limit: null, offset: 0 });
		}
		const hash = /^\/v4\/commodity\/(\w+)\/transactions$/.exec(pathname)?.[1];
		const ledger = hash === undefined ? undefined : ledgers[hash];
		if (ledger === undefined) return Promise.reject(new Error(`unexpected request: ${address}`));
		if (ledger instanceof Error) return Promise.reject(ledger);
		if ('status' in ledger) {
			return answer({ error: 'Something went wrong', status: ledger.status }, ledger.status);
		}
		return answer({
			commodity: ledger.commodity ?? { hash, dq: '41dq', hostname: DONATION_TWIN },
			calculation: { transactionCount: ledger.rows.length, transactions: ledger.rows }
		});
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await test.destroy();
});

/** Puts the fixture campaign where a donation matters: raising money, with an item and a goal. */
async function setCampaign(
	values: {
		status?: CampaignStatus;
		fundingGoal?: number | null;
		donationCommodityId?: number | null;
	} = {}
) {
	await test.db
		.update(campaigns)
		.set({ status: 'funding', fundingGoal: GOAL, donationCommodityId: DONATION_ID, ...values })
		.where(eq(campaigns.id, CAMPAIGN));
}

/** One ledger row, as Qatom returns it for a donation. */
function donation(
	twistId: string,
	amount: number,
	fromAddress = DONOR_A,
	timestamp = '2026-11-14T08:00:00.000Z'
) {
	return {
		twistId,
		timestamp,
		amount,
		fromAddress,
		destinationAddress: DONATION_TWIN,
		operation: 'transfer',
		fileType: 'dq',
		commodityHash: DONATION_HASH
	};
}

async function run(headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }) {
	const request = new Request('http://localhost/api/funding', { method: 'POST', headers });
	const account = createMerchantAccount({
		paymentApiUrl: API,
		clientId: 'merchant-account-id',
		clientSecret: 'merchant-account-secret'
	});
	const locals = {
		ctx: { db: test.db, config: { CHECKIN_SHARED_SECRET: SECRET }, qatom: { account } }
	};
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	const text = await response.text();
	return { status: response.status, text, body: JSON.parse(text) as FundingRefreshSummary };
}

const campaign = async () => (await getCampaign(test.db, CAMPAIGN))!;
const funding = async () => getFundingSummary(test.db, await campaign());
const stored = () => test.db.select().from(campaignFunding);

async function home() {
	const event = { locals: { ctx: { db: test.db } } };
	const data = await loadHome(event as unknown as Parameters<typeof loadHome>[0]);
	if (!data) throw new Error('the home load returned nothing');
	return data;
}

async function overview() {
	const event = {
		params: { campaignId: CAMPAIGN },
		locals: {
			ctx: { db: test.db, config: { OIDC_REDIRECT_URI: 'http://localhost:5174/auth/callback' } }
		},
		url: new URL(`http://localhost/campaigns/${CAMPAIGN}`)
	};
	const data = await loadOverview(event as unknown as Parameters<typeof loadOverview>[0]);
	if (!data) throw new Error('the overview load returned nothing');
	return data;
}

describe('POST /api/funding', () => {
	it('refuses a caller without the shared secret, and reads no ledger', async () => {
		await setCampaign();
		ledgers[DONATION_HASH] = { rows: [donation('d1', 1200)] };

		expect((await run({})).status).toBe(401);
		expect((await run({ [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect((await run({ [CHECKIN_SECRET_HEADER]: `${SECRET}x` })).status).toBe(401);

		expect(requests).toEqual([]);
		expect(await stored()).toEqual([]);
		expect(await funding()).toEqual({ state: 'not_known', reason: 'never_read', goal: GOAL });
	});

	it('stores the totals of a first read', async () => {
		await setCampaign();
		ledgers[DONATION_HASH] = {
			rows: [donation('d1', 1200), donation('d2', 300, DONOR_B), donation('d3', 500)]
		};

		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toEqual({
			campaigns: 1,
			campaignsWithoutDonationItem: 0,
			ledgersRead: 1,
			ledgerErrors: [],
			updated: [
				{ campaignId: CAMPAIGN, raised: 2000, donations: 3, becameFunded: false, rowsNotCounted: 0 }
			]
		} satisfies FundingRefreshSummary);
		expect(await funding()).toEqual({
			state: 'known',
			goal: GOAL,
			raised: 2000,
			donations: 3,
			readAt: expect.any(String),
			goalMet: false
		});
		expect((await campaign()).status).toBe('funding');
	});

	it('reads with the merchant account token only, and only ever asks: no write, no transfer', async () => {
		await setCampaign();
		ledgers[DONATION_HASH] = { rows: [donation('d1', 1200)] };

		await run();

		expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(
			[
				'POST /v4/account/oauth/token',
				'GET /v4/catalog/items',
				`GET /v4/commodity/${DONATION_HASH}/transactions`
			]
		);
		expect(requests.slice(1).map((request) => request.authorization)).toEqual([
			'Bearer account-token',
			'Bearer account-token'
		]);
		expect(requests.some((request) => request.url.includes('transfer'))).toBe(false);
	});

	it('stores the same totals when run again, and adds what has come in since', async () => {
		await setCampaign();
		ledgers[DONATION_HASH] = { rows: [donation('d1', 1200), donation('d2', 300, DONOR_B)] };

		await run();
		const again = await run();

		expect(again.body.updated).toEqual([
			{ campaignId: CAMPAIGN, raised: 1500, donations: 2, becameFunded: false, rowsNotCounted: 0 }
		]);
		expect(await stored()).toHaveLength(1);
		expect(await funding()).toMatchObject({ raised: 1500, donations: 2 });

		ledgers[DONATION_HASH] = {
			rows: [donation('d1', 1200), donation('d2', 300, DONOR_B), donation('d3', 250)]
		};
		await run();

		expect(await stored()).toHaveLength(1);
		expect(await funding()).toMatchObject({ raised: 1750, donations: 3, goalMet: false });
	});

	it('moves funding to funded when the goal is reached, once, and does nothing else', async () => {
		await setCampaign();
		const before = await campaign();
		ledgers[DONATION_HASH] = { rows: [donation('d1', 3000), donation('d2', 2000, DONOR_B)] };

		const first = await run();

		expect(first.body.updated).toEqual([
			{ campaignId: CAMPAIGN, raised: 5000, donations: 2, becameFunded: true, rowsNotCounted: 0 }
		]);
		// Only the status moved: no catalog item was created and no commodity id stored.
		expect(await campaign()).toEqual({ ...before, status: 'funded' });
		expect(await funding()).toMatchObject({ state: 'known', raised: 5000, goalMet: true });
		expect(
			requests.every((request) => request.method === 'GET' || request.url.endsWith('/token'))
		).toBe(true);

		const second = await run();

		expect(second.body.updated[0]).toMatchObject({ becameFunded: false });
		expect((await campaign()).status).toBe('funded');
	});

	it('does not move a campaign that is short of its goal, or that has no goal', async () => {
		await setCampaign();
		ledgers[DONATION_HASH] = { rows: [donation('d1', GOAL - 1)] };
		await run();
		expect((await campaign()).status).toBe('funding');

		await setCampaign({ fundingGoal: null });
		ledgers[DONATION_HASH] = { rows: [donation('d1', 9_000_000)] };
		const { body } = await run();

		expect(body.updated[0]).toMatchObject({ raised: 9_000_000, becameFunded: false });
		expect((await campaign()).status).toBe('funding');
		expect(await funding()).toMatchObject({ state: 'known', goal: null, goalMet: false });
	});

	it('never moves a status backwards, or any status but funding', async () => {
		for (const status of ['draft', 'funded', 'reporting', 'overdue', 'delivered'] as const) {
			await setCampaign({ status });
			ledgers[DONATION_HASH] = { rows: [donation('d1', GOAL * 2)] };
			expect((await run()).body.updated[0], status).toMatchObject({ becameFunded: false });
			expect((await campaign()).status, status).toBe(status);

			ledgers[DONATION_HASH] = { rows: [] };
			await run();
			expect((await campaign()).status, status).toBe(status);
		}
	});

	it('skips a campaign without a donation item, and asks Qatom nothing', async () => {
		// The seeded campaign: a goal, and no donation item.
		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toEqual({
			campaigns: 0,
			campaignsWithoutDonationItem: 1,
			ledgersRead: 0,
			ledgerErrors: [],
			updated: []
		} satisfies FundingRefreshSummary);
		expect(requests).toEqual([]);
		expect(await stored()).toEqual([]);
		expect(await funding()).toEqual({
			state: 'not_known',
			reason: 'no_donation_item',
			goal: fixtures.campaign.fundingGoal
		});
	});

	it('stores a known zero for a ledger that was read and is empty', async () => {
		await setCampaign();
		ledgers[DONATION_HASH] = { rows: [] };

		await run();

		expect(await funding()).toMatchObject({ state: 'known', raised: 0, donations: 0 });
	});

	describe('when Qatom fails', () => {
		beforeEach(async () => {
			await setCampaign();
			ledgers[DONATION_HASH] = { rows: [donation('d1', 1200), donation('d2', 300, DONOR_B)] };
			await run();
		});

		const untouched = async () => {
			expect(await funding()).toMatchObject({ state: 'known', raised: 1500, donations: 2 });
			expect((await campaign()).status).toBe('funding');
		};

		it('leaves the stored totals untouched when the ledger answers with an error', async () => {
			const before = await stored();
			ledgers[DONATION_HASH] = { status: 502 };

			const { status, body } = await run();

			expect(status).toBe(200);
			expect(body).toMatchObject({ campaigns: 1, ledgersRead: 0, updated: [] });
			expect(body.ledgerErrors).toEqual([
				{ campaignId: CAMPAIGN, problem: expect.stringContaining('502') }
			]);
			expect(await stored()).toEqual(before);
			await untouched();
		});

		it('leaves them untouched when Qatom cannot be reached', async () => {
			const before = await stored();
			ledgers[DONATION_HASH] = new Error('connection reset');

			const { body } = await run();

			expect(body.ledgerErrors).toHaveLength(1);
			expect(body.updated).toEqual([]);
			expect(await stored()).toEqual(before);
			await untouched();
		});

		it('leaves them untouched when Qatom does not know the commodity id', async () => {
			const before = await stored();
			catalog = {};

			const { body } = await run();

			expect(body.ledgerErrors).toEqual([
				{ campaignId: CAMPAIGN, problem: expect.stringContaining(String(DONATION_ID)) }
			]);
			expect(await stored()).toEqual(before);
			await untouched();
		});

		it('leaves them untouched when a row has a field missing: a partial total is not stored', async () => {
			const before = await stored();
			ledgers[DONATION_HASH] = {
				rows: [donation('d1', 1200), { twistId: 'd9', amount: 9000, timestamp: 'x' }]
			};

			const { body } = await run();

			expect(body.ledgerErrors).toEqual([
				{ campaignId: CAMPAIGN, problem: expect.stringContaining('field missing') }
			]);
			expect(await stored()).toEqual(before);
			await untouched();
		});

		it('leaves them untouched when an amount is not a positive whole number of our unit', async () => {
			const before = await stored();
			for (const amount of [0.1, -500, 0]) {
				ledgers[DONATION_HASH] = { rows: [donation('d1', 1200), donation('d9', amount)] };

				const { body } = await run();

				expect(body.ledgerErrors, String(amount)).toEqual([
					{ campaignId: CAMPAIGN, problem: expect.stringContaining('whole number') }
				]);
				expect(await stored()).toEqual(before);
			}
			await untouched();
		});

		it('does not move a campaign to funded on a read that failed', async () => {
			await setCampaign({ fundingGoal: 1000 });
			ledgers[DONATION_HASH] = { status: 500 };

			await run();

			expect((await campaign()).status).toBe('funding');
		});
	});

	describe('telling a donation from anything else on the ledger', () => {
		beforeEach(() => setCampaign());

		it('counts a row listed twice once', async () => {
			ledgers[DONATION_HASH] = { rows: [donation('d1', 1200), donation('d1', 1200)] };

			await run();

			expect(await funding()).toMatchObject({ raised: 1200, donations: 1 });
		});

		it('does not count a row that names another commodity', async () => {
			ledgers[DONATION_HASH] = {
				rows: [donation('d1', 1200), { ...donation('x1', 700), commodityHash: 'somethingelse' }]
			};

			const { body } = await run();

			expect(body.updated[0]).toMatchObject({ raised: 1200, donations: 1, rowsNotCounted: 1 });
		});

		it('does not count a row that was not paid to the twin that owns the commodity', async () => {
			ledgers[DONATION_HASH] = {
				rows: [
					donation('d1', 1200),
					// Money leaving the donation twin: paid from it, to somewhere else.
					{ ...donation('x1', 700, DONATION_TWIN), destinationAddress: DONOR_B }
				]
			};

			const { body } = await run();

			expect(body.updated[0]).toMatchObject({ raised: 1200, donations: 1, rowsNotCounted: 1 });
		});

		it('accepts the receiving address as a twin URL as well as a bare hostname', async () => {
			ledgers[DONATION_HASH] = {
				rows: [{ ...donation('d1', 1200), destinationAddress: `https://${DONATION_TWIN}` }]
			};

			await run();

			expect(await funding()).toMatchObject({ raised: 1200, donations: 1 });
		});

		it('counts every row, as the document describes the ledger, when it names no owning twin and rows name no commodity', async () => {
			const { commodityHash: _ignored, ...bare } = donation('d1', 1200);
			ledgers[DONATION_HASH] = { rows: [bare], commodity: { dq: '41dq' } };

			const { body } = await run();

			expect(body.updated[0]).toMatchObject({ raised: 1200, donations: 1, rowsNotCounted: 0 });
		});

		it('refuses to read a deposit item as the donation item', async () => {
			await setCampaign({ donationCommodityId: fixtures.campaign.logWorkCommodityId });

			const { body } = await run();

			expect(body.ledgerErrors).toEqual([
				{ campaignId: CAMPAIGN, problem: expect.stringContaining('Deposits are not donations') }
			]);
			expect(requests).toEqual([]);
			expect(await stored()).toEqual([]);
		});
	});

	describe('what leaves the server', () => {
		beforeEach(async () => {
			await setCampaign();
			ledgers[DONATION_HASH] = {
				rows: [donation('twist-d1', 1200, DONOR_A), donation('twist-d2', 300, `https://${DONOR_B}`)]
			};
		});

		const DONOR_MARKS = [DONOR_A, DONOR_B, 'donor-', 'twist-d1', 'twist-d2', DONATION_TWIN];

		it('names no donor, wallet or transaction in the answer of the route', async () => {
			const { text } = await run();

			for (const mark of DONOR_MARKS) expect(text, mark).not.toContain(mark);
		});

		it('stores no donor, wallet or transaction', async () => {
			await run();

			const kept = JSON.stringify(await stored());
			for (const mark of DONOR_MARKS) expect(kept, mark).not.toContain(mark);
			expect(Object.keys((await stored())[0] ?? {}).sort()).toEqual(
				['campaignId', 'donations', 'raised', 'readAt'].sort()
			);
		});

		it('gives the home page totals only', async () => {
			await run();
			const data = await home();

			expect(data.campaigns[0]?.funding).toEqual({
				state: 'known',
				goal: GOAL,
				raised: 1500,
				donations: 2,
				readAt: expect.any(String),
				goalMet: false
			});
			const sent = JSON.stringify(data);
			for (const mark of DONOR_MARKS) expect(sent, mark).not.toContain(mark);
			expect(sent).not.toContain(String(DONATION_ID));
			expect(sent).not.toContain(DONATION_HASH);
		});

		it('gives the campaign overview totals only', async () => {
			await run();
			const data = await overview();

			expect(data.funding).toEqual({
				state: 'known',
				goal: GOAL,
				raised: 1500,
				donations: 2,
				readAt: expect.any(String),
				goalMet: false
			});
			const sent = JSON.stringify(data);
			for (const mark of DONOR_MARKS) expect(sent, mark).not.toContain(mark);
			expect(sent).not.toContain(String(DONATION_ID));
			expect(sent).not.toContain(DONATION_HASH);
		});

		it('gives both pages "not known" until the ledger has been read', async () => {
			const notKnown = { state: 'not_known', reason: 'never_read', goal: GOAL };

			expect((await home()).campaigns[0]?.funding).toEqual(notKnown);
			expect((await overview()).funding).toEqual(notKnown);
		});
	});
});
