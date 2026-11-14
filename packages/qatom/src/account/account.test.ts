// These tests never reach the network: `fetch` is replaced, here in the test file, by a stub
// that records each request and plays back a prepared answer.
import { primaryWalletHostnameSchema } from '@tejido/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	QatomHttpError,
	QatomNetworkError,
	QatomResponseError,
	QatomTimeoutError
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

const tokenAnswer = (token = 'token-1', secondsLeft = 3600): Answer => ({
	json: { access_token: token, expires_at: Math.floor(NOW / 1000) + secondsLeft }
});

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
		commodity: { hash: 'abc123', descriptor: 'Library wing log work', cost: 100, dq: '41dq' },
		calculation: {
			totalAmount: 200,
			transactionCount: 3,
			transactions: [
				{
					timestamp: '2026-11-13T17:02:10.000Z',
					twistId: '41aa',
					operation: 'transfer',
					amount: 100,
					fromAddress: 'payer.micro.biz.todaq.net',
					destinationAddress: 'item.micro.biz.todaq.net',
					fileType: 'dq',
					commodityHash: 'abc123'
				},
				{ timestamp: '2026-11-12T10:00:00.000Z', twistId: '41bb', amount: 100 },
				{
					timestamp: '2026-11-06T16:20:03.000Z',
					twistId: '41cc',
					amount: 100,
					fromAddress: 'https://other.micro.biz.todaq.net',
					destinationAddress: 'item.micro.biz.todaq.net'
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

	it('returns twistId, timestamp, amount, paying and receiving address for each sale', async () => {
		answer(tokenAnswer(), ledgerAnswer);
		const ledger = await account().listCommodityTransactions('abc123');

		expect(ledger).toEqual({
			commodityHash: 'abc123',
			dq: '41dq',
			incompleteTransactions: 1,
			transactions: [
				{
					twistId: '41aa',
					timestamp: '2026-11-13T17:02:10.000Z',
					amount: 100,
					payingAddress: 'payer.micro.biz.todaq.net',
					receivingAddress: 'item.micro.biz.todaq.net'
				},
				{
					twistId: '41cc',
					timestamp: '2026-11-06T16:20:03.000Z',
					amount: 100,
					payingAddress: 'https://other.micro.biz.todaq.net',
					receivingAddress: 'item.micro.biz.todaq.net'
				}
			]
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

	it('refuses a hash that could change the request path, before any request', async () => {
		await expect(account().listCommodityTransactions('../user')).rejects.toBeInstanceOf(TypeError);
		expect(requests).toHaveLength(0);
	});
});

describe('a transfer', () => {
	const primary = primaryWalletHostnameSchema.parse('0f6d2b9e.micro.biz.todaq.net');
	const accepted: Answer = { status: 202, json: {} };

	it('goes to a primary wallet as a twin URL, in the smallest unit', async () => {
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
				amount: 1200,
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
			amount: 100
		});
	});

	it.each([0, -100, 0.1, Number.NaN])(
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

	it('is sent once more after a 401, where nothing has moved', async () => {
		answer(tokenAnswer('token-1'), { status: 401, json: {} }, tokenAnswer('token-2'), accepted);
		await account().transfer({ to: { primaryWalletHostname: primary }, dq: '41dq', amount: 100 });

		expect(requests.filter((request) => request.url.endsWith('/v4/transfer'))).toHaveLength(2);
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
							? { access_token: 't', expires_at: NOW / 1000 + 3600 }
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
