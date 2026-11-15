// The purchase lookup: what Qatom's own record says about one sale.
//
// NOTHING HERE REACHES QATOM OR ANY NETWORK. `fetch` is replaced for every test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QatomHttpError, QatomResponseError } from '../errors.ts';
import { createMerchantAccount } from './index.ts';

const API = 'https://pay.stage.m.todaq.net';
const TRANSACTION = '3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12';
const TOKEN = 'account-token';

let requests: { method: string; url: string; authorization: string | null }[];
let answer: () => Response;

const purchase = (fields: Record<string, unknown> = {}) =>
	Response.json({
		purchase: {
			transaction_id: TRANSACTION,
			catalog_item_id: 42,
			amount: '0.100',
			dq: '41dq',
			settled_at: '2026-11-15T12:20:03.000Z',
			dispatch_status: 'delivered',
			...fields
		}
	});

beforeEach(() => {
	requests = [];
	answer = () => purchase();
	vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		requests.push({ method, url, authorization: new Headers(init?.headers).get('authorization') });
		if (url === `${API}/v4/account/oauth/token`) {
			return Response.json({ access_token: TOKEN, expires_at: '4102444800' });
		}
		if (method === 'GET' && url === `${API}/v4/catalog/purchases/${TRANSACTION}`) return answer();
		throw new Error(`A test made a request it did not expect: ${method} ${url}`);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const account = () =>
	createMerchantAccount({
		paymentApiUrl: API,
		clientId: 'test-account-client',
		clientSecret: 'test-account-secret'
	});

describe('getPurchase', () => {
	it('reads a settled purchase with the merchant account token, and only reads', async () => {
		expect(await account().getPurchase(TRANSACTION)).toEqual({
			status: 'settled',
			catalogItemId: 42,
			amount: 100,
			settledAt: '2026-11-15T12:20:03.000Z'
		});
		expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
			`POST ${API}/v4/account/oauth/token`,
			`GET ${API}/v4/catalog/purchases/${TRANSACTION}`
		]);
		expect(requests[1]!.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it('gives the amount in our thousandths: "1.000" is 1000, "0.100" is 100', async () => {
		answer = () => purchase({ amount: '1.000' });
		expect(await account().getPurchase(TRANSACTION)).toMatchObject({ amount: 1000 });
		answer = () => purchase({ amount: '0.1' });
		expect(await account().getPurchase(TRANSACTION)).toMatchObject({ amount: 100 });
		answer = () => purchase({ amount: '2' });
		expect(await account().getPurchase(TRANSACTION)).toMatchObject({ amount: 2000 });
	});

	it('gives the settled time in UTC whatever zone Qatom wrote it in', async () => {
		answer = () => purchase({ settled_at: '2026-11-15T07:20:03-05:00' });
		expect(await account().getPurchase(TRANSACTION)).toMatchObject({
			settledAt: '2026-11-15T12:20:03.000Z'
		});
	});

	it('says not found for a 404', async () => {
		answer = () => Response.json({ error: 'Not found', status: 404 }, { status: 404 });
		expect(await account().getPurchase(TRANSACTION)).toEqual({ status: 'not_found' });
	});

	it('says not settled when the purchase has no settled time', async () => {
		answer = () => purchase({ settled_at: null });
		expect(await account().getPurchase(TRANSACTION)).toEqual({ status: 'not_settled' });
		answer = () => purchase({ settled_at: undefined });
		expect(await account().getPurchase(TRANSACTION)).toEqual({ status: 'not_settled' });
	});

	it('fails on any other error from Qatom, rather than calling it not found', async () => {
		for (const status of [403, 500, 503]) {
			answer = () => Response.json({ error: 'no' }, { status });
			await expect(account().getPurchase(TRANSACTION)).rejects.toBeInstanceOf(QatomHttpError);
		}
	});

	it('fails on an answer it cannot read, rather than guessing', async () => {
		for (const fields of [
			{ amount: 0.1 },
			{ amount: 'a lot' },
			{ amount: '-1.000' },
			{ amount: '0.000' },
			{ catalog_item_id: 'forty-two' },
			{ catalog_item_id: undefined },
			{ settled_at: 'yesterday' },
			{ transaction_id: '9a1d4e7c-2b36-4f58-a0c9-7e5b3d1f6a24' }
		]) {
			answer = () => purchase(fields);
			await expect(
				account().getPurchase(TRANSACTION),
				JSON.stringify(fields)
			).rejects.toBeInstanceOf(QatomResponseError);
		}
		answer = () => Response.json({ unexpected: true });
		await expect(account().getPurchase(TRANSACTION)).rejects.toBeInstanceOf(QatomResponseError);
	});

	it('refuses a transaction id that is not a UUID before asking Qatom anything', async () => {
		for (const id of ['', 'abc', '../transfer', `${TRANSACTION}/x`, `${TRANSACTION}?a=1`]) {
			await expect(account().getPurchase(id), id).rejects.toBeInstanceOf(TypeError);
		}
		expect(requests).toEqual([]);
	});
});
