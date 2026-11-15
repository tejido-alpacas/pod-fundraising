// The merchant account's two calls for donations: listing its own catalog items and making a
// checkout link. These tests never reach the network: `fetch` is replaced, here in the test
// file, by a stub that records each request and plays back a prepared answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QatomHttpError, QatomResponseError } from '../errors.ts';
import { createMerchantAccount } from './index.ts';

const API = 'https://pay.stage.m.todaq.net';
const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const CHECKOUT = 'https://checkout.m.todaq.net/checkout/5f0c7c1e-8a4b-4d2f-9c61-3b7e2a9d4f10';

interface Recorded {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string | undefined;
}

type Answer = { status?: number; json?: unknown };

let requests: Recorded[];
let answers: Answer[];

const tokenAnswer: Answer = {
	json: { access_token: 'token-1', expires_at: String(Math.floor(NOW / 1000) + 3600) }
};

beforeEach(() => {
	requests = [];
	answers = [];
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	vi.stubGlobal('fetch', (url: string | URL, init: RequestInit = {}) => {
		requests.push({
			method: init.method ?? 'GET',
			url: String(url),
			headers: init.headers as Record<string, string>,
			body: init.body as string | undefined
		});
		const next = answers.shift();
		if (!next) return Promise.reject(new Error('unexpected request'));
		return Promise.resolve(
			new Response(next.json === undefined ? '' : JSON.stringify(next.json), {
				status: next.status ?? 200
			})
		);
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const account = () =>
	createMerchantAccount({
		paymentApiUrl: API,
		clientId: 'merchant-account-id',
		clientSecret: 'merchant-account-secret'
	});

describe('listOwnCatalogItems', () => {
	it('lists the items the account has on sale, with prices in our unit and their endpoints', async () => {
		answers.push(tokenAnswer, {
			json: {
				items: [
					{
						id: 41,
						commodity_id: 118,
						active: true,
						commodity_cost: 0.1,
						external_endpoint: 'https://tejido.net/api/checkins'
					},
					{
						id: 128,
						commodity_id: 301,
						commodity_hash: '3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12',
						active: true,
						commodity_cost: 5,
						external_endpoint: 'https://tejido.net/api/donations/5'
					}
				],
				total: 2,
				limit: null,
				offset: 0
			}
		});

		expect(await account().listOwnCatalogItems()).toEqual([
			{
				catalogItemId: 41,
				price: 100,
				externalEndpoint: 'https://tejido.net/api/checkins',
				commodityId: 118,
				commodityHash: null
			},
			{
				catalogItemId: 128,
				price: 5000,
				externalEndpoint: 'https://tejido.net/api/donations/5',
				commodityId: 301,
				commodityHash: '3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12'
			}
		]);
		expect(requests[1]).toMatchObject({
			method: 'GET',
			url: `${API}/v4/catalog/items?mine=true&active=true`,
			headers: { authorization: 'Bearer token-1' }
		});
	});

	it('leaves out an item the answer says is not on sale, whatever the filter', async () => {
		answers.push(tokenAnswer, {
			json: { items: [{ id: 128, active: false, commodity_cost: 5, external_endpoint: null }] }
		});

		expect(await account().listOwnCatalogItems()).toEqual([]);
	});

	it('gives no price, never a guessed one, when Qatom gives none that can be used', async () => {
		answers.push(tokenAnswer, {
			json: {
				items: [
					{ id: 1, external_endpoint: 'https://tejido.net/api/donations/5' },
					{ id: 2, commodity_cost: '5', external_endpoint: null },
					{ id: 3, commodity_cost: 0 },
					{ id: 4, commodity_cost: -5, external_endpoint: '' }
				]
			}
		});

		expect(await account().listOwnCatalogItems()).toEqual(
			[
				{ catalogItemId: 1, price: null, externalEndpoint: 'https://tejido.net/api/donations/5' },
				{ catalogItemId: 2, price: null, externalEndpoint: null },
				{ catalogItemId: 3, price: null, externalEndpoint: null },
				{ catalogItemId: 4, price: null, externalEndpoint: null }
			].map((item) => ({ ...item, commodityId: null, commodityHash: null }))
		);
	});

	it('gives no commodity, never a guessed one, when Qatom gives none in the form one has', async () => {
		answers.push(tokenAnswer, {
			json: {
				items: [
					{ id: 1, commodity_id: '301', commodity_hash: 301 },
					{ id: 2, commodity_id: 0, commodity_hash: '../v4/twins' },
					{ id: 3, commodity_id: 1.5, commodity_hash: '' },
					{ id: 4, commodity_id: 7, commodity_hash: 'abc123' }
				]
			}
		});

		const items = await account().listOwnCatalogItems();
		expect(items.map(({ commodityId, commodityHash }) => [commodityId, commodityHash])).toEqual([
			[null, null],
			[null, null],
			[null, null],
			[7, 'abc123']
		]);
	});

	it('refuses an answer that is not a list of items with an id each', async () => {
		answers.push(tokenAnswer, { json: { total: 0 } });
		await expect(account().listOwnCatalogItems()).rejects.toBeInstanceOf(QatomResponseError);

		answers.push(tokenAnswer, { json: { items: [{ commodity_cost: 5 }] } });
		await expect(account().listOwnCatalogItems()).rejects.toBeInstanceOf(QatomResponseError);
	});
});

describe('createCheckout', () => {
	it('asks for a checkout of one item with its inputs, and answers the link', async () => {
		answers.push(tokenAnswer, {
			status: 201,
			json: { hash: '5f0c7c1e-8a4b-4d2f-9c61-3b7e2a9d4f10', url: CHECKOUT }
		});

		const checkout = await account().createCheckout({
			catalogItemId: 128,
			inputs: { campaign_id: 'library-wing' }
		});

		expect(checkout).toEqual({ url: CHECKOUT });
		expect(requests[1]).toEqual({
			method: 'POST',
			url: `${API}/v4/payment/checkout`,
			headers: {
				accept: 'application/json',
				authorization: 'Bearer token-1',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ catalog_item_id: 128, arguments: { campaign_id: 'library-wing' } })
		});
	});

	it("uses the merchant account, and sends no amount: the price is the item's", async () => {
		answers.push(tokenAnswer, { status: 201, json: { hash: 'h', url: CHECKOUT } });
		await account().createCheckout({ catalogItemId: 128, inputs: { campaign_id: 'c' } });

		expect(requests[0]!.url).toBe(`${API}/v4/account/oauth/token`);
		expect(requests[1]!.body).not.toMatch(/amount|cost|price/);
		// Two requests only: the token and the checkout. Nothing is transferred.
		expect(requests).toHaveLength(2);
	});

	it.each([0, -1, 1.5, Number.NaN])('refuses the item id %s without calling Qatom', async (id) => {
		await expect(account().createCheckout({ catalogItemId: id, inputs: {} })).rejects.toThrow(
			RangeError
		);
		expect(requests).toEqual([]);
	});

	it("passes on Qatom's refusal when a required input is missing or the item is not on sale", async () => {
		answers.push(tokenAnswer, {
			status: 400,
			json: {
				error: 'Missing required details: campaign_id',
				status: 400,
				missing_arguments: ['campaign_id']
			}
		});

		const error: unknown = await account()
			.createCheckout({ catalogItemId: 128, inputs: {} })
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(QatomHttpError);
		expect(error).toMatchObject({ status: 400 });
	});

	it.each([
		['no link', { hash: 'h' }],
		['a link that is not https', { hash: 'h', url: 'http://checkout.m.todaq.net/checkout/h' }],
		['a link that is not a URL', { hash: 'h', url: 'checkout/h' }],
		['a script', { hash: 'h', url: 'javascript:alert(1)' }],
		['a link carrying a login', { hash: 'h', url: 'https://user:pw@checkout.m.todaq.net/h' }]
	])('refuses an answer with %s: a donor is never sent there', async (_name, json) => {
		answers.push(tokenAnswer, { status: 201, json });

		await expect(
			account().createCheckout({ catalogItemId: 128, inputs: { campaign_id: 'c' } })
		).rejects.toBeInstanceOf(QatomResponseError);
	});

	it('does not ask twice: one call makes one checkout', async () => {
		answers.push(tokenAnswer, {
			status: 500,
			json: { error: 'Internal Server Error', status: 500 }
		});

		await expect(
			account().createCheckout({ catalogItemId: 128, inputs: { campaign_id: 'c' } })
		).rejects.toBeInstanceOf(QatomHttpError);
		expect(requests.map((request) => request.url)).toEqual([
			`${API}/v4/account/oauth/token`,
			`${API}/v4/payment/checkout`
		]);
	});
});
