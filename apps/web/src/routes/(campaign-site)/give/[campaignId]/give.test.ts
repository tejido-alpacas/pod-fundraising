// Calls the Give page's own load and action against a real, migrated, seeded database. The
// merchant account is the real client; `fetch` is replaced, here in the test file, by a stub
// that records each request and plays back a prepared answer. Nothing reaches the network.
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, listDonations } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server.ts';

const API = 'https://pay.stage.m.todaq.net';
const SITE = 'https://tejido.example';
const CAMPAIGN = fixtures.campaign.id;
const CHECKOUT = 'https://checkout.m.todaq.net/checkout/5f0c7c1e-8a4b-4d2f-9c61-3b7e2a9d4f10';

type Answer = { status?: number; json?: unknown };

let test: TestDatabase;
let requests: { method: string; url: string; body: string | undefined }[];
let answers: Answer[];
let account: ReturnType<typeof createMerchantAccount>;

const tokenAnswer: Answer = {
	json: { access_token: 'token-1', expires_at: String(Math.floor(Date.now() / 1000) + 3600) }
};

/** Tejido's catalog as Qatom lists it: the two filing items, and donation items for 5 and 25. */
const catalog: Answer = {
	json: {
		items: [
			{ id: 41, active: true, commodity_cost: 0.1, external_endpoint: `${SITE}/api/checkins` },
			{ id: 42, active: true, commodity_cost: 1, external_endpoint: `${SITE}/api/checkins` },
			{ id: 130, active: true, commodity_cost: 25, external_endpoint: `${SITE}/api/donations/25` },
			{ id: 128, active: true, commodity_cost: 5, external_endpoint: `${SITE}/api/donations/5` }
		]
	}
};

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	await test.db.update(campaigns).set({ status: 'funding' }).where(eq(campaigns.id, CAMPAIGN));
	requests = [];
	answers = [];
	vi.stubGlobal('fetch', (url: string | URL, init: RequestInit = {}) => {
		requests.push({
			method: init.method ?? 'GET',
			url: String(url),
			body: init.body as string | undefined
		});
		const next = answers.shift();
		if (!next) return Promise.reject(new TypeError('fetch failed'));
		return Promise.resolve(
			new Response(next.json === undefined ? '' : JSON.stringify(next.json), {
				status: next.status ?? 200
			})
		);
	});
	account = createMerchantAccount({
		paymentApiUrl: API,
		clientId: 'merchant-account-id',
		clientSecret: 'merchant-account-secret'
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await test.destroy();
});

const locals = () => ({
	ctx: {
		db: test.db,
		config: { WEB_OIDC_REDIRECT_URI: `${SITE}/auth/callback` },
		qatom: { account }
	},
	session: null
});

async function page(campaignId = CAMPAIGN) {
	const data = await load({
		params: { campaignId },
		locals: locals()
	} as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('the load returned nothing');
	return data;
}

/** Presses one amount's button. Answers where the browser is sent, or what the page is told. */
async function give(amount: string | null, campaignId = CAMPAIGN) {
	const body = new URLSearchParams(amount === null ? {} : { amount });
	const request = new Request(`${SITE}/give/${campaignId}`, { method: 'POST', body });
	try {
		const result = await actions.default({
			request,
			params: { campaignId },
			locals: locals()
		} as unknown as Parameters<typeof actions.default>[0]);
		return { sentTo: null, result: result as { status: number; data: { problem: string } } };
	} catch (thrown) {
		const { status, location } = thrown as { status?: number; location?: string };
		if (status === undefined || location === undefined) throw thrown;
		return { sentTo: { status, location }, result: null };
	}
}

const checkoutRequests = () => requests.filter((request) => request.url.endsWith('/checkout'));

describe('the Give page', () => {
	it('offers the amounts Tejido has donation items for, smallest first', async () => {
		answers.push(tokenAnswer, catalog);
		const data = await page();

		expect(data.open).toBe(true);
		expect(data.amounts).toEqual([
			{ value: 5000, shown: '5.00' },
			{ value: 25_000, shown: '25.00' }
		]);
		expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
			`POST ${API}/v4/account/oauth/token`,
			`GET ${API}/v4/catalog/items?mine=true&active=true`
		]);
	});

	it('shows the goal, and what has been given once there is a donation', async () => {
		answers.push(tokenAnswer, catalog);
		expect((await page()).funding).toEqual({ goal: '12000.00', raised: null, donations: null });
	});

	it('gives the campaign by the fields a donor may see: no email', async () => {
		answers.push(tokenAnswer, catalog);
		const data = await page();

		expect(data.campaign).toEqual({
			id: CAMPAIGN,
			title: fixtures.campaign.title,
			beneficiary: fixtures.campaign.beneficiary,
			creatorName: fixtures.campaign.creatorName,
			path: `/campaigns/${CAMPAIGN}`
		});
		expect(JSON.stringify(data)).not.toContain('@');
	});

	it.each([
		['is for another site', `https://other.example/api/donations/5`, 5],
		['is not https', `http://tejido.example/api/donations/5`, 5],
		['costs something other than its address says', `${SITE}/api/donations/5`, 50],
		['has a query', `${SITE}/api/donations/5?campaign=x`, 5],
		['names no whole amount', `${SITE}/api/donations/0.5`, 0.5],
		['has a placeholder for the amount', `${SITE}/api/donations/{input.amount}`, 5],
		['is the check-in endpoint', `${SITE}/api/checkins`, 5]
	])('does not offer an item whose endpoint %s', async (_name, endpoint, cost) => {
		answers.push(tokenAnswer, {
			json: {
				items: [{ id: 128, active: true, commodity_cost: cost, external_endpoint: endpoint }]
			}
		});

		expect((await page()).amounts).toEqual([]);
	});

	it('says giving is not available, and shows no amounts, when Qatom cannot be asked', async () => {
		// No answer prepared: the request fails as a dropped connection would.
		const data = await page();

		expect(data.amounts).toBeNull();
	});

	it.each(['draft', 'funded', 'reporting', 'overdue', 'delivered'] as const)(
		'is closed for a %s campaign, and does not ask Qatom',
		async (status) => {
			await test.db.update(campaigns).set({ status }).where(eq(campaigns.id, CAMPAIGN));
			const data = await page();

			expect(data.open).toBe(false);
			expect(data.amounts).toEqual([]);
			expect(requests).toEqual([]);
		}
	);

	it('is not found for a campaign that does not exist', async () => {
		await expect(page('nope')).rejects.toMatchObject({ status: 404 });
	});
});

describe('pressing an amount', () => {
	it("asks Qatom for a checkout of that amount's item for this campaign, and sends the donor there", async () => {
		answers.push(tokenAnswer, catalog, { status: 201, json: { hash: 'h', url: CHECKOUT } });

		const { sentTo } = await give('5000');

		expect(sentTo).toEqual({ status: 303, location: CHECKOUT });
		expect(checkoutRequests()).toEqual([
			{
				method: 'POST',
				url: `${API}/v4/payment/checkout`,
				body: JSON.stringify({ catalog_item_id: 128, arguments: { campaign_id: CAMPAIGN } })
			}
		]);
	});

	it('makes a new link for every press: a link is for one purchase', async () => {
		answers.push(
			tokenAnswer,
			catalog,
			{ status: 201, json: { hash: 'h1', url: `${CHECKOUT}-1` } },
			catalog,
			{ status: 201, json: { hash: 'h2', url: `${CHECKOUT}-2` } }
		);

		expect((await give('25000')).sentTo?.location).toBe(`${CHECKOUT}-1`);
		expect((await give('25000')).sentTo?.location).toBe(`${CHECKOUT}-2`);
		expect(checkoutRequests()).toHaveLength(2);
	});

	it('records nothing and moves no money: the donation is recorded when Qatom says it was paid', async () => {
		answers.push(tokenAnswer, catalog, { status: 201, json: { hash: 'h', url: CHECKOUT } });
		await give('5000');

		expect(await listDonations(test.db, CAMPAIGN)).toEqual([]);
		expect(requests.some((request) => request.url.includes('/transfer'))).toBe(false);
	});

	it.each(['10000', '5', '0', '-5000', '5000.5', 'five', '128', null])(
		'makes no checkout for the amount %s: no donation item sells it',
		async (amount) => {
			answers.push(tokenAnswer, catalog);
			const { sentTo, result } = await give(amount);

			expect(sentTo).toBeNull();
			expect(result).toMatchObject({ data: { problem: 'gone' } });
			expect(checkoutRequests()).toEqual([]);
		}
	);

	it('makes no checkout for a campaign that is not raising money', async () => {
		await test.db.update(campaigns).set({ status: 'funded' }).where(eq(campaigns.id, CAMPAIGN));
		const { result } = await give('5000');

		expect(result).toMatchObject({ status: 409, data: { problem: 'closed' } });
		expect(requests).toEqual([]);
	});

	it('says giving is not available when Qatom refuses or does not answer', async () => {
		answers.push(tokenAnswer, catalog, {
			status: 400,
			json: { error: 'Catalog item not found or inactive', status: 400 }
		});
		expect((await give('5000')).result).toMatchObject({
			status: 503,
			data: { problem: 'unavailable' }
		});

		// Nothing prepared: the listing itself fails.
		expect((await give('5000')).result).toMatchObject({
			status: 503,
			data: { problem: 'unavailable' }
		});
	});

	it('never sends the donor to a link that is not https', async () => {
		answers.push(tokenAnswer, catalog, {
			status: 201,
			json: { hash: 'h', url: 'http://checkout.example/h' }
		});
		const { sentTo, result } = await give('5000');

		expect(sentTo).toBeNull();
		expect(result).toMatchObject({ status: 503, data: { problem: 'unavailable' } });
	});
});
