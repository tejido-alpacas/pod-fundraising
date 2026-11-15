// These tests never reach the network: `fetch` is replaced, here in the test file, by a stub
// that records each request and plays back a prepared answer.
import { primaryWalletHostnameSchema } from '@tejido/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	QatomError,
	QatomHttpError,
	QatomNetworkError,
	QatomResponseError,
	QatomTimeoutError,
	QatomUnknownCommodityError
} from '../errors.ts';
import { sameTwin, twinHostname } from '../index.ts';
import { createMerchantAccount } from './index.ts';

const API = 'https://pay.stage.m.todaq.net';
const CLIENT_ID = 'merchant-account-id';
const CLIENT_SECRET = 'merchant-account-secret';
const NOW = Date.parse('2026-11-14T12:00:00.000Z');

interface Recorded {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string | undefined;
}

type Answer = { status?: number; json?: unknown; text?: string } | Error;

let requests: Recorded[];
let answers: Answer[];

function answer(...next: Answer[]) {
	answers.push(...next);
}

// `expires_at` is a string of digits, as Qatom's server sends it.
const tokenAnswer = (token = 'token-1', secondsLeft = 3600): Answer => ({
	json: { access_token: token, expires_at: String(Math.floor(NOW / 1000) + secondsLeft) }
});

/** A commodity hash as Qatom's server gives it: a UUID with hyphens. */
const UUID_HASH = '3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12';

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
		if (next instanceof Error) return Promise.reject(next);
		return Promise.resolve(
			new Response(next.text ?? (next.json === undefined ? '' : JSON.stringify(next.json)), {
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
	createMerchantAccount({ paymentApiUrl: API, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

const ledgerAnswer: Answer = {
	json: {
		commodity: {
			hash: 'abc123',
			descriptor: 'Library wing log work',
			cost: 0.1,
			dq: '41dq',
			hostname: 'item.micro.biz.todaq.net'
		},
		calculation: {
			totalAmount: 0.2,
			transactionCount: 3,
			transactions: [
				{
					timestamp: '2026-11-13T17:02:10.000Z',
					twistId: '41aa',
					operation: 'receive',
					amount: 0.1,
					fromAddress: 'payer.micro.biz.todaq.net',
					destinationAddress: 'item.micro.biz.todaq.net',
					fileType: 'dq',
					commodityHash: 'abc123'
				},
				{ timestamp: '2026-11-12T10:00:00.000Z', twistId: '41bb', amount: 0.1 },
				{
					timestamp: '2026-11-06T16:20:03.000Z',
					twistId: '41cc',
					amount: 1,
					fromAddress: 'https://other.micro.biz.todaq.net'
				}
			]
		}
	}
};

describe('the account token', () => {
	it('is fetched with the account credentials as Basic auth, and no body', async () => {
		answer(tokenAnswer(), ledgerAnswer);
		await account().listCommodityTransactions('abc123');

		expect(requests[0]).toEqual({
			method: 'POST',
			url: `${API}/v4/account/oauth/token`,
			headers: {
				accept: 'application/json',
				authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
			},
			body: undefined
		});
	});

	it('is cached and reused', async () => {
		const merchant = account();
		answer(tokenAnswer(), ledgerAnswer, ledgerAnswer);
		await merchant.listCommodityTransactions('abc123');
		await merchant.listCommodityTransactions('abc123');

		expect(requests.map((request) => request.url.split('/v4/')[1])).toEqual([
			'account/oauth/token',
			'commodity/abc123/transactions',
			'commodity/abc123/transactions'
		]);
	});

	it('is fetched once when several calls start together', async () => {
		const merchant = account();
		answer(tokenAnswer(), ledgerAnswer, ledgerAnswer);
		await Promise.all([
			merchant.listCommodityTransactions('abc123'),
			merchant.listCommodityTransactions('abc123')
		]);

		expect(requests.filter((request) => request.url.endsWith('/oauth/token'))).toHaveLength(1);
	});

	it('is replaced before it expires', async () => {
		const merchant = account();
		answer(tokenAnswer('token-1', 3600), ledgerAnswer);
		await merchant.listCommodityTransactions('abc123');

		vi.setSystemTime(NOW + 3600_000 - 30_000); // thirty seconds left
		answer(tokenAnswer('token-2', 7200), ledgerAnswer);
		await merchant.listCommodityTransactions('abc123');

		expect(requests[2]?.url).toContain('/oauth/token');
		expect(requests[3]?.headers.authorization).toBe('Bearer token-2');
	});

	it('is replaced, and the call repeated once, when Qatom answers 401', async () => {
		const merchant = account();
		answer(
			tokenAnswer('token-1'),
			{ status: 401, json: { error: 'Authentication required', status: 401 } },
			tokenAnswer('token-2'),
			ledgerAnswer
		);
		const ledger = await merchant.listCommodityTransactions('abc123');

		expect(ledger.transactions).toHaveLength(2);
		expect(requests.map((request) => request.headers.authorization?.split(' ')[0])).toEqual([
			'Basic',
			'Bearer',
			'Basic',
			'Bearer'
		]);
		expect(requests[3]?.headers.authorization).toBe('Bearer token-2');
	});

	it('gives up after a second 401', async () => {
		const unauthorized: Answer = { status: 401, json: { error: 'Authentication required' } };
		answer(tokenAnswer('token-1'), unauthorized, tokenAnswer('token-2'), unauthorized);

		await expect(account().listCommodityTransactions('abc123')).rejects.toMatchObject({
			name: 'QatomHttpError',
			status: 401,
			code: 'Authentication required'
		});
		expect(requests).toHaveLength(4);
	});

	it('reads expires_at whether it is in seconds or milliseconds', async () => {
		const merchant = account();
		answer({ json: { access_token: 'token-ms', expires_at: NOW + 3600_000 } }, ledgerAnswer);
		await merchant.listCommodityTransactions('abc123');
		answer(ledgerAnswer);
		await merchant.listCommodityTransactions('abc123');

		expect(requests.filter((request) => request.url.endsWith('/oauth/token'))).toHaveLength(1);
	});

	it('reports wrong credentials without repeating them', async () => {
		answer({ status: 401, json: { error: 'Authentication required', status: 401 } });
		const error = await account()
			.listCommodityTransactions('abc123')
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(QatomHttpError);
		expect(error).toMatchObject({ operation: 'account.token', status: 401 });
		expect(JSON.stringify(error) + String(error)).not.toContain(CLIENT_SECRET);
	});

	it('refuses a token answer without access_token and expires_at', async () => {
		answer({ json: { access_token: 'token-1' } });
		await expect(account().listCommodityTransactions('abc123')).rejects.toBeInstanceOf(
			QatomResponseError
		);
	});

	it('reads expires_at as a string of digits, which is what the server sends, and caches by it', async () => {
		const merchant = account();
		answer(
			{ json: { access_token: 'token-1', expires_at: String(Math.floor(NOW / 1000) + 3600) } },
			ledgerAnswer,
			ledgerAnswer
		);
		await merchant.listCommodityTransactions('abc123');
		await merchant.listCommodityTransactions('abc123');
		expect(requests.filter((request) => request.url.endsWith('/oauth/token'))).toHaveLength(1);

		// And it is replaced when that time comes.
		vi.setSystemTime(NOW + 3600_000 - 30_000);
		answer(tokenAnswer('token-2', 7200), ledgerAnswer);
		await merchant.listCommodityTransactions('abc123');
		expect(requests.at(-1)?.headers.authorization).toBe('Bearer token-2');
	});

	it('still reads expires_at as a number, as the document shows it', async () => {
		answer(
			{ json: { access_token: 'token-1', expires_at: Math.floor(NOW / 1000) + 3600 } },
			ledgerAnswer
		);
		await expect(account().listCommodityTransactions('abc123')).resolves.toBeDefined();
	});

	it.each(['', 'soon', '12.5', '-5', '1e9', ' 1794571200', '0', null, true, 0, -1, 1.5, {}])(
		'refuses the expires_at %j',
		async (expires_at) => {
			answer({ json: { access_token: 'token-1', expires_at } });
			await expect(account().listCommodityTransactions('abc123')).rejects.toBeInstanceOf(
				QatomResponseError
			);
			expect(requests).toHaveLength(1);
		}
	);
});

describe('the ledger', () => {
	it("asks for one commodity's transactions with the account token", async () => {
		answer(tokenAnswer('token-1'), ledgerAnswer);
		await account().listCommodityTransactions('abc123');

		expect(requests[1]).toEqual({
			method: 'GET',
			url: `${API}/v4/commodity/abc123/transactions`,
			headers: { accept: 'application/json', authorization: 'Bearer token-1' },
			body: undefined
		});
	});

	it('returns twistId, timestamp, the amount in our thousandths, the addresses, the operation and any commodity named, for each sale', async () => {
		answer(tokenAnswer(), ledgerAnswer);
		const ledger = await account().listCommodityTransactions('abc123');

		expect(ledger).toEqual({
			commodityHash: 'abc123',
			dq: '41dq',
			twinHostname: 'item.micro.biz.todaq.net',
			incompleteTransactions: 1,
			transactions: [
				{
					twistId: '41aa',
					timestamp: '2026-11-13T17:02:10.000Z',
					// Qatom said 0.1.
					amount: 100,
					payingAddress: 'payer.micro.biz.todaq.net',
					receivingAddress: 'item.micro.biz.todaq.net',
					operation: 'receive',
					commodityHash: 'abc123'
				},
				{
					twistId: '41cc',
					timestamp: '2026-11-06T16:20:03.000Z',
					// Qatom said 1. The row has no destinationAddress and no operation: still a row.
					amount: 1000,
					payingAddress: 'https://other.micro.biz.todaq.net',
					receivingAddress: null,
					operation: null,
					commodityHash: null
				}
			]
		});
	});

	it('says so when the ledger does not name the twin that owns the commodity', async () => {
		answer(tokenAnswer(), {
			json: { commodity: { dq: '41dq' }, calculation: { transactions: [] } }
		});

		expect(await account().listCommodityTransactions('abc123')).toMatchObject({
			twinHostname: null
		});
	});

	it('carries the status and Qatom error when the account does not own the commodity', async () => {
		answer(tokenAnswer(), { status: 403, json: { error: 'account_not_granted', status: 403 } });

		await expect(account().listCommodityTransactions('abc123')).rejects.toMatchObject({
			name: 'QatomHttpError',
			operation: 'account.ledger',
			status: 403,
			code: 'account_not_granted'
		});
	});

	it('refuses an answer without calculation.transactions', async () => {
		answer(tokenAnswer(), { json: { commodity: {} } });
		await expect(account().listCommodityTransactions('abc123')).rejects.toBeInstanceOf(
			QatomResponseError
		);
	});

	it.each([
		'../user',
		'abc/def',
		'abc?x=1',
		'abc#x',
		'abc def',
		'%2e%2e',
		'',
		'-',
		'3f2b8c1e-5d47-4a9b-8e21',
		'3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12-',
		'3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12/..',
		'3f2b8c1e_5d47_4a9b_8e21_0c6d9f4a7b12'
	])('refuses the hash %j, which is not a commodity hash, before any request', async (hash) => {
		await expect(account().listCommodityTransactions(hash)).rejects.toBeInstanceOf(TypeError);
		expect(requests).toHaveLength(0);
	});

	it('reads the ledger of a commodity whose hash is a UUID with hyphens', async () => {
		answer(tokenAnswer(), ledgerAnswer);
		const ledger = await account().listCommodityTransactions(UUID_HASH);

		expect(requests[1]?.url).toBe(`${API}/v4/commodity/${UUID_HASH}/transactions`);
		expect(ledger.commodityHash).toBe(UUID_HASH);
	});

	it.each([
		[0.1, 100],
		[1, 1000],
		[1.1, 1100],
		[0.30000000000000004, 300],
		[0.1234, 123]
	])('reads a row amount of %s USD-TDN as %s of our thousandths', async (decimal, units) => {
		answer(tokenAnswer(), {
			json: {
				calculation: {
					transactions: [{ twistId: '41aa', timestamp: 't', amount: decimal, fromAddress: 'a.b' }]
				}
			}
		});
		const ledger = await account().listCommodityTransactions(UUID_HASH);

		expect(ledger.transactions.map((row) => row.amount)).toEqual([units]);
	});

	it.each(['0.1', null, 1e300, [0.1]])(
		'counts a row whose amount is %j as unusable, and does not return it',
		async (amount) => {
			answer(tokenAnswer(), {
				text: JSON.stringify({
					calculation: {
						transactions: [{ twistId: '41aa', timestamp: 't', amount, fromAddress: 'a.b' }]
					}
				})
			});
			const ledger = await account().listCommodityTransactions(UUID_HASH);

			expect(ledger).toMatchObject({ transactions: [], incompleteTransactions: 1 });
		}
	);

	it('keeps a paying address in whatever form the ledger gives it, such as a hexadecimal address', async () => {
		const hex = `41${'0123456789abcdef'.repeat(4)}`;
		answer(tokenAnswer(), {
			json: {
				calculation: {
					transactions: [{ twistId: '41aa', timestamp: 't', amount: 0.1, fromAddress: hex }]
				}
			}
		});
		const ledger = await account().listCommodityTransactions(UUID_HASH);

		expect(ledger.transactions[0]?.payingAddress).toBe(hex);
	});
});

describe('a commodity id', () => {
	const HASH = '9f2c4e1a7b3d5f60819a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70';
	const item = (commodity_id: number, commodity_hash: string = HASH) => ({
		id: 42,
		commodity_id,
		commodity_hash,
		active: true,
		commodity_name: 'Library wing log work'
	});
	const listing = (...items: unknown[]): Answer => ({
		json: { items, total: items.length, limit: null, offset: 0 }
	});

	it("is turned into its hash from the account's own catalog listing", async () => {
		answer(tokenAnswer('token-1'), listing(item(3152)));
		expect(await account().resolveCommodityHash(3152)).toBe(HASH);

		expect(requests[1]).toEqual({
			method: 'GET',
			url: `${API}/v4/catalog/items?commodity_id=3152&mine=true&active=all`,
			headers: { accept: 'application/json', authorization: 'Bearer token-1' },
			body: undefined
		});
	});

	it('is asked about once, and remembered after that', async () => {
		const merchant = account();
		answer(tokenAnswer(), listing(item(3152)));
		await merchant.resolveCommodityHash(3152);
		expect(await merchant.resolveCommodityHash(3152)).toBe(HASH);

		expect(requests).toHaveLength(2);
	});

	it('is asked about once when several calls start together', async () => {
		const merchant = account();
		answer(tokenAnswer(), listing(item(3152)));
		const hashes = await Promise.all([
			merchant.resolveCommodityHash(3152),
			merchant.resolveCommodityHash(3152)
		]);

		expect(hashes).toEqual([HASH, HASH]);
		expect(requests).toHaveLength(2);
	});

	it('is remembered separately from other ids', async () => {
		const merchant = account();
		answer(tokenAnswer(), listing(item(3152)), listing(item(3153, 'abc123')));

		expect(await merchant.resolveCommodityHash(3152)).toBe(HASH);
		expect(await merchant.resolveCommodityHash(3153)).toBe('abc123');
		expect(await merchant.resolveCommodityHash(3152)).toBe(HASH);
		expect(requests).toHaveLength(3);
	});

	it('is reported as unknown when the listing has no item for it', async () => {
		answer(tokenAnswer(), listing());
		const error = await account()
			.resolveCommodityHash(3152)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(QatomUnknownCommodityError);
		expect(error).toBeInstanceOf(QatomError);
		expect(error).toMatchObject({ operation: 'account.commodity-hash', commodityId: 3152 });
	});

	it("is reported as unknown when the listing only holds another commodity's item", async () => {
		answer(tokenAnswer(), listing(item(9999, 'abc123')));
		await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(
			QatomUnknownCommodityError
		);
	});

	it('is asked about again after it was unknown or the listing failed', async () => {
		const merchant = account();
		answer(tokenAnswer(), listing(), { status: 500, json: { error: 'Internal', status: 500 } });
		await expect(merchant.resolveCommodityHash(3152)).rejects.toBeInstanceOf(
			QatomUnknownCommodityError
		);
		await expect(merchant.resolveCommodityHash(3152)).rejects.toMatchObject({
			name: 'QatomHttpError',
			operation: 'account.commodity-hash',
			status: 500
		});

		answer(listing(item(3152)));
		expect(await merchant.resolveCommodityHash(3152)).toBe(HASH);
		expect(requests).toHaveLength(4);
	});

	it('reports a listing that could not be reached or did not answer in time', async () => {
		answer(tokenAnswer(), new TypeError('fetch failed'));
		await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(QatomNetworkError);

		answer(tokenAnswer(), new DOMException('timed out', 'TimeoutError'));
		await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(QatomTimeoutError);
	});

	it('refuses an answer without items, or an item without its hash', async () => {
		answer(tokenAnswer(), { json: { total: 0 } });
		await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(QatomResponseError);

		answer(tokenAnswer(), listing({ id: 42, commodity_id: 3152 }));
		await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(QatomResponseError);
	});

	it('is turned into a hash that is a UUID with hyphens, which is what the server gives', async () => {
		const merchant = account();
		answer(tokenAnswer(), listing(item(3152, UUID_HASH)), ledgerAnswer);

		const hash = await merchant.resolveCommodityHash(3152);
		expect(hash).toBe(UUID_HASH);
		// And that hash reads the ledger.
		await merchant.listCommodityTransactions(hash);
		expect(requests[2]?.url).toBe(`${API}/v4/commodity/${UUID_HASH}/transactions`);
	});

	it.each(['3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12/x', 'a-b', 'abc def', '..', ''])(
		'refuses the listed hash %j',
		async (hash) => {
			answer(tokenAnswer(), listing(item(3152, hash)));
			await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(QatomResponseError);
		}
	);

	it('refuses a hash that could change a request path, and two hashes for one id', async () => {
		answer(tokenAnswer(), listing(item(3152, '../user')));
		await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(QatomResponseError);

		answer(tokenAnswer(), listing(item(3152), item(3152, 'abc123')));
		await expect(account().resolveCommodityHash(3152)).rejects.toBeInstanceOf(QatomResponseError);
	});

	it.each([0, -1, 1.5, Number.NaN])('refuses the id %s before any request', async (id) => {
		await expect(account().resolveCommodityHash(id)).rejects.toBeInstanceOf(RangeError);
		expect(requests).toHaveLength(0);
	});
});

describe('a transfer', () => {
	const primary = primaryWalletHostnameSchema.parse('0f6d2b9e.micro.biz.todaq.net');
	const accepted: Answer = { status: 202, json: {} };

	it('goes to a primary wallet as a twin URL, in decimal USD-TDN: our 1200 is sent as 1.2', async () => {
		answer(tokenAnswer('token-1'), accepted);
		await account().transfer({
			to: { primaryWalletHostname: primary },
			dq: '41dq',
			amount: 1200,
			note: 'Deposits returned: Foundation and floor slab'
		});

		expect(requests[1]).toEqual({
			method: 'POST',
			url: `${API}/v4/transfer`,
			headers: {
				accept: 'application/json',
				authorization: 'Bearer token-1',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				address: 'https://0f6d2b9e.micro.biz.todaq.net',
				type: '41dq',
				amount: 1.2,
				note: 'Deposits returned: Foundation and floor slab'
			})
		});
	});

	it('can be addressed to an email instead', async () => {
		answer(tokenAnswer(), accepted);
		await account().transfer({ to: { email: 'ada@example.com' }, dq: '41dq', amount: 100 });

		expect(JSON.parse(requests[1]?.body ?? '{}')).toEqual({
			address: 'ada@example.com',
			type: '41dq',
			amount: 0.1
		});
	});

	// Qatom does no scaling and no checking of the amount: whatever number arrives is sent.
	it.each([
		[100, '0.1'],
		[1000, '1'],
		[1100, '1.1'],
		[1, '0.001'],
		[1234, '1.234'],
		[300, '0.3'],
		[2500000, '2500']
	])('sends our %s as %s on the wire', async (units, wire) => {
		answer(tokenAnswer(), accepted);
		await account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: units });

		expect(/"amount":([^,}]+)/.exec(requests[1]?.body ?? '')?.[1]).toBe(wire);
	});

	it.each([0, -100, 0.1, 100.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
		'refuses the amount %s before any request',
		async (amount) => {
			await expect(
				account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount })
			).rejects.toBeInstanceOf(RangeError);
			expect(requests).toHaveLength(0);
		}
	);

	it('reports an underfunded wallet as 402', async () => {
		answer(tokenAnswer(), { status: 402, json: { error: 'Insufficient balance', status: 402 } });

		await expect(
			account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 })
		).rejects.toMatchObject({ status: 402, code: 'Insufficient balance' });
	});

	it('keeps the detail Qatom gives for a refused address', async () => {
		answer(tokenAnswer(), {
			status: 400,
			json: { status: 400, error: 'Bad Request', message: 'address must be a twin URL or an email' }
		});

		await expect(
			account().transfer({ to: { email: 'not-an-email' }, dq: '41dq', amount: 100 })
		).rejects.toMatchObject({
			status: 400,
			code: 'Bad Request',
			detail: 'address must be a twin URL or an email'
		});
	});

	it('is not sent again after a server error', async () => {
		answer(tokenAnswer(), { status: 500, json: { error: 'Transfer failed' } });

		await expect(
			account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 })
		).rejects.toMatchObject({ status: 500 });
		expect(requests.filter((request) => request.url.endsWith('/v4/transfer'))).toHaveLength(1);
	});

	it('is not sent again after a timeout, whose outcome is unknown', async () => {
		answer(tokenAnswer(), Object.assign(new Error('timed out'), { name: 'TimeoutError' }));

		const error = await account()
			.transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(QatomTimeoutError);
		expect(error).toMatchObject({ operation: 'account.transfer', timeoutMs: 30_000 });
		expect(requests.filter((request) => request.url.endsWith('/v4/transfer'))).toHaveLength(1);
	});

	it('is NOT sent again after a 401: on this route that is the wallet refusing, not an expired token', async () => {
		answer(
			tokenAnswer('token-1'),
			{ status: 401, json: { error: 'Unauthorized', status: 401 } },
			// Were the client to try again, these would let a second transfer through.
			tokenAnswer('token-2'),
			accepted
		);

		await expect(
			account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 })
		).rejects.toMatchObject({ name: 'QatomHttpError', operation: 'account.transfer', status: 401 });
		expect(requests.filter((request) => request.url.endsWith('/v4/transfer'))).toHaveLength(1);
		expect(requests).toHaveLength(2);
	});

	it.each([400, 401, 402, 403, 404, 409, 422, 429, 500, 502, 503])(
		'is sent exactly once when Qatom answers %s',
		async (status) => {
			answer(tokenAnswer('token-1'), { status, json: {} }, tokenAnswer('token-2'), accepted);

			await expect(
				account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 })
			).rejects.toMatchObject({ status });
			expect(requests.filter((request) => request.url.endsWith('/v4/transfer'))).toHaveLength(1);
		}
	);

	it('is not sent again when Qatom cannot be reached', async () => {
		answer(tokenAnswer(), new TypeError('fetch failed'), accepted);

		await expect(
			account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 })
		).rejects.toBeInstanceOf(QatomNetworkError);
		expect(requests.filter((request) => request.url.endsWith('/v4/transfer'))).toHaveLength(1);
	});

	it('asks for a new token for the NEXT call after a 403, which is how this route refuses a token', async () => {
		const merchant = account();
		answer(tokenAnswer('token-1'), { status: 403, json: { error: 'Forbidden', status: 403 } });
		await expect(
			merchant.transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 })
		).rejects.toMatchObject({ status: 403 });
		expect(requests).toHaveLength(2);

		// A separate, later transfer, asked for by the caller: it starts with a new token.
		answer(tokenAnswer('token-2'), accepted);
		await merchant.transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 });
		expect(requests[3]?.headers.authorization).toBe('Bearer token-2');
		expect(requests.filter((request) => request.url.endsWith('/v4/transfer'))).toHaveLength(2);
	});

	it('still repeats a READ once after a 401, with a new token', async () => {
		answer(tokenAnswer('token-1'), { status: 401, json: {} }, tokenAnswer('token-2'), ledgerAnswer);
		await account().listCommodityTransactions('abc123');

		expect(requests.filter((request) => request.url.endsWith('/transactions'))).toHaveLength(2);
	});
});

describe('every call', () => {
	it('sets a timeout and does not follow redirects', async () => {
		const seen: RequestInit[] = [];
		vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
			seen.push(init);
			return Promise.resolve(
				new Response(
					JSON.stringify(
						seen.length === 1
							? { access_token: 't', expires_at: String(NOW / 1000 + 3600) }
							: { calculation: { transactions: [] } }
					)
				)
			);
		});
		await account().listCommodityTransactions('abc123');

		for (const init of seen) {
			expect(init.signal).toBeInstanceOf(AbortSignal);
			expect(init.redirect).toBe('manual');
		}
	});

	it('reports an unreachable Qatom as a network error', async () => {
		answer(new TypeError('fetch failed'));
		await expect(account().listCommodityTransactions('abc123')).rejects.toBeInstanceOf(
			QatomNetworkError
		);
	});

	it('reports an error body that is not JSON by its status alone', async () => {
		answer(tokenAnswer(), { status: 502, text: '<html>Bad gateway</html>' });
		await expect(account().listCommodityTransactions('abc123')).rejects.toMatchObject({
			status: 502,
			code: null,
			detail: null
		});
	});

	it('treats a redirect as an error rather than following it', async () => {
		answer({ status: 302, text: '' });
		await expect(account().listCommodityTransactions('abc123')).rejects.toMatchObject({
			status: 302
		});
	});
});

describe('comparing wallet addresses', () => {
	it('treats a hostname and its twin URL as the same twin', () => {
		expect(twinHostname('https://ABC.micro.biz.todaq.net/')).toBe('abc.micro.biz.todaq.net');
		expect(sameTwin('abc.micro.biz.todaq.net', 'https://abc.micro.biz.todaq.net')).toBe(true);
		expect(sameTwin('abc.micro.biz.todaq.net', 'abd.micro.biz.todaq.net')).toBe(false);
		expect(sameTwin('', '')).toBe(false);
	});
});

// The request and answer shapes below are the ones in Qatom's API document
// ({PAYMENT_API_URL}/v4/openapi.json). They have not been run against Qatom.
describe('creating a catalog item', () => {
	const bearer = { accept: 'application/json', authorization: 'Bearer token-1' };
	const json = { ...bearer, 'content-type': 'application/json' };

	it('creates a provider twin and does not read its key', async () => {
		answer(tokenAnswer(), {
			status: 201,
			json: { id: 3601, hostname: '0f6d2b9e.micro.biz.todaq.net', key: 'twin-key', balances: {} }
		});

		const twin = await account().createProviderTwin({ dq: '41dq' });

		expect(twin).toEqual({ twinId: 3601, hostname: '0f6d2b9e.micro.biz.todaq.net' });
		expect(requests[1]).toEqual({
			method: 'POST',
			url: `${API}/v4/twin`,
			headers: json,
			body: JSON.stringify({ dq: '41dq', type: 'provider' })
		});
	});

	it('lists what a twin sells', async () => {
		answer(tokenAnswer(), {
			json: [
				// Qatom lists the price in decimal USD-TDN, and its hashes are UUIDs with hyphens.
				{ hash: UUID_HASH, descriptor: 'Log work', dq: '41dq', cost: 0.1, hostname: 'h' },
				{ hash: '41b1' }
			]
		});

		expect(await account().listTwinCommodities('0f6d2b9e.micro.biz.todaq.net')).toEqual([
			{ hash: UUID_HASH, descriptor: 'Log work', dq: '41dq', cost: 100 },
			{ hash: '41b1', descriptor: null, dq: null, cost: null }
		]);
		expect(requests[1]).toMatchObject({
			method: 'GET',
			url: `${API}/v4/twin/0f6d2b9e.micro.biz.todaq.net/commodities`,
			headers: bearer
		});
	});

	it('creates a commodity on a twin and answers its hash', async () => {
		answer(tokenAnswer(), {
			status: 201,
			json: { hash: UUID_HASH, descriptor: 'Log work', cost: 0.1 }
		});

		const created = await account().createCommodity({
			twinId: 3601,
			descriptor: 'Log work',
			cost: 100,
			dq: '41dq'
		});

		expect(created).toEqual({ commodityHash: UUID_HASH });
		expect(requests[1]).toEqual({
			method: 'POST',
			url: `${API}/v4/commodity`,
			headers: json,
			// Our price of 100 thousandths is stored by Qatom as 0.1 USD-TDN.
			body: JSON.stringify({ descriptor: 'Log work', cost: 0.1, dq: '41dq', twin_id: 3601 })
		});
	});

	it('refuses a commodity with no price, a fraction of a unit or no twin, before any request', async () => {
		const commodity = { twinId: 3601, descriptor: 'Log work', cost: 100, dq: '41dq' };
		for (const wrong of [{ cost: 0 }, { cost: 0.5 }, { twinId: 0 }, { descriptor: '' }]) {
			await expect(account().createCommodity({ ...commodity, ...wrong })).rejects.toBeInstanceOf(
				RangeError
			);
		}
		expect(requests).toHaveLength(0);
	});

	it('names a commodity with PUT and answers its id', async () => {
		answer(tokenAnswer(), { json: { commodity: { id: 118, hash: '41b0', name: 'Log work' } } });

		const described = await account().describeCommodity('41b0', {
			name: 'Log work',
			description: 'File a work log.'
		});

		expect(described).toEqual({ commodityId: 118 });
		expect(requests[1]).toEqual({
			method: 'PUT',
			url: `${API}/v4/commodity/41b0`,
			headers: json,
			body: JSON.stringify({ name: 'Log work', description: 'File a work log.' })
		});
	});

	it('does not make up a commodity id the answer does not carry', async () => {
		answer(tokenAnswer(), { json: { commodity: { hash: '41b0' } } });
		await expect(
			account().describeCommodity('41b0', { name: 'Log work', description: 'File a work log.' })
		).rejects.toBeInstanceOf(QatomResponseError);
	});

	it('finds the catalog item of a commodity, or none', async () => {
		answer(
			tokenAnswer(),
			{ json: { items: [{ id: 42, commodity_id: 118 }], total: 1, limit: null, offset: 0 } },
			{ json: { items: [], total: 0, limit: null, offset: 0 } }
		);
		const merchant = account();

		expect(await merchant.findCatalogItem(118)).toEqual({ catalogItemId: 42, commodityId: 118 });
		expect(await merchant.findCatalogItem(119)).toBeNull();
		expect(requests[1]!.url).toBe(`${API}/v4/catalog/items?commodity_id=118&mine=true&active=all`);
	});

	const newItem = {
		commodityId: 118,
		serviceSchema: { type: 'object', properties: { summary: { type: 'string' } } },
		externalEndpoint: 'https://tejido.net/api/checkins',
		secretHeader: { name: 'X-Tejido-Checkin-Secret', value: 'a-secret-value-a-secret-value-1234' }
	};

	it('creates a featured item that POSTs to the endpoint, with its secret header in the same request', async () => {
		answer(tokenAnswer(), {
			status: 201,
			json: { item: { id: 42, commodity_id: 118, featured: true }, dispatch_params: [] }
		});

		expect(await account().createCatalogItem(newItem)).toEqual({
			catalogItemId: 42,
			commodityId: 118
		});
		expect(requests[1]).toEqual({
			method: 'POST',
			url: `${API}/v4/catalog/items`,
			headers: json,
			body: JSON.stringify({
				commodity_id: 118,
				service_method: 'POST',
				service_schema: newItem.serviceSchema,
				external_endpoint: 'https://tejido.net/api/checkins',
				active: true,
				featured: true,
				dispatch_params: [
					{
						kind: 'header',
						name: 'X-Tejido-Checkin-Secret',
						sensitive: true,
						value: 'a-secret-value-a-secret-value-1234'
					}
				]
			})
		});
	});

	it('refuses an endpoint that is not https or a header Qatom would not take, without showing the value', async () => {
		const wrong = [
			{ externalEndpoint: 'http://tejido.net/api/checkins' },
			{ externalEndpoint: 'https://tejido.net/{secret.x}' },
			{ secretHeader: { name: 'X Bad', value: 'value' } },
			{ secretHeader: { name: 'X-Tejido-Checkin-Secret', value: ' padded-secret ' } }
		];
		for (const change of wrong) {
			const error: unknown = await account()
				.createCatalogItem({ ...newItem, ...change })
				.catch((thrown: unknown) => thrown);
			expect(error).toBeInstanceOf(TypeError);
			expect((error as Error).message).not.toContain('padded-secret');
		}
		expect(requests).toHaveLength(0);
	});

	it('never sends a create call twice: a timeout, a dropped connection and a 500 are reported once', async () => {
		const merchant = account();
		answer(tokenAnswer(), new DOMException('timed out', 'TimeoutError'));
		await expect(merchant.createProviderTwin({ dq: '41dq' })).rejects.toBeInstanceOf(
			QatomTimeoutError
		);
		answer(new TypeError('fetch failed'));
		await expect(
			merchant.createCommodity({ twinId: 3601, descriptor: 'Log work', cost: 100, dq: '41dq' })
		).rejects.toBeInstanceOf(QatomNetworkError);
		answer({ status: 500, json: { error: 'Internal Server Error', status: 500 } });
		await expect(merchant.createCatalogItem(newItem)).rejects.toMatchObject({ status: 500 });

		// The token, then each create call exactly once.
		expect(requests.map((request) => request.url)).toEqual([
			`${API}/v4/account/oauth/token`,
			`${API}/v4/twin`,
			`${API}/v4/commodity`,
			`${API}/v4/catalog/items`
		]);
	});

	it('keeps the secret out of the error when Qatom refuses the item', async () => {
		answer(tokenAnswer(), {
			status: 400,
			json: { error: 'dispatch_params[0].name is a header payment sets itself', status: 400 }
		});

		const error: unknown = await account()
			.createCatalogItem(newItem)
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(QatomHttpError);
		expect(JSON.stringify(error) + String(error)).not.toContain(newItem.secretHeader.value);
	});
});
