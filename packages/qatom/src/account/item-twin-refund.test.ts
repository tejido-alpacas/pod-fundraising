// The one exception: an end-to-end test person's deposits go back to their AGENT wallet, out
// of the item's own twin, by the twin's own API.
//
// NOTHING HERE REACHES QATOM, A TWIN OR ANY NETWORK, AND NOTHING MOVES MONEY. `fetch` is
// replaced for every test, and a request the test did not expect fails it.
import { agentWalletHostnameSchema } from '@tejido/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QatomError } from '../errors.ts';
import {
	createMerchantAccount,
	E2E_TEST_EMAIL_DOMAIN,
	isEndToEndTestEmail,
	type ItemTwinRefundRequest
} from './index.ts';
import { isWalletHostname } from './item-twin-refund.ts';

const API = 'https://pay.stage.m.todaq.net';
const HASH = '3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12';
const DQ = '41dq000000000000000000000000000000000000000000000000000000000000aa';
const ITEM_TWIN = 'item0001.micro.biz.todaq.net';
const AGENT = 'agent0001.micro.biz.todaq.net';
/** The twin's API key in these tests. It must never come out of the package. */
const KEY = 'twin-key-SECRET-5f1c9a';
const TOKEN = 'account-token-SECRET';
const TEST_EMAIL = `contractor@${E2E_TEST_EMAIL_DOMAIN}`;

interface Seen {
	method: string;
	url: string;
	authorization: string | null;
	body: unknown;
}

let requests: Seen[];
let ledger: () => Response;
let twins: () => Response;
let balance: () => Response | Promise<Response>;
let transfer: () => Response | Promise<Response>;
/** Everything written to the console while a test ran. */
let logged: string;

const twinRequests = () => requests.filter(({ url }) => url.startsWith(`https://${ITEM_TWIN}/`));
const transfers = () => twinRequests().filter(({ method }) => method === 'POST');

beforeEach(() => {
	requests = [];
	logged = '';
	ledger = () =>
		Response.json({
			commodity: { hash: HASH, dq: DQ, hostname: ITEM_TWIN },
			calculation: { transactions: [] }
		});
	twins = () =>
		Response.json({
			twins: [
				{ id: 1, key: 'another-key', hostname: 'main0001.biz.todaq.net', is_primary: true },
				{ id: 2, key: KEY, hostname: ITEM_TWIN, twin_type: 'provider', balances: { [DQ]: 2.1 } }
			]
		});
	balance = () => Response.json({ balance: 2.1 });
	transfer = () => Response.json({ ok: true });

	for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
			logged += `${parts.map(String).join(' ')}\n`;
		});
	}

	vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input);
		const method = init?.method ?? 'GET';
		const headers = new Headers(init?.headers);
		requests.push({
			method,
			url: url.href,
			authorization: headers.get('authorization'),
			body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
		});

		if (url.origin === API) {
			if (method === 'POST' && url.pathname === '/v4/account/oauth/token') {
				return Response.json({ access_token: TOKEN, expires_at: '4102444800' });
			}
			if (method === 'GET' && url.pathname === `/v4/commodity/${HASH}/transactions`) {
				return ledger();
			}
			if (method === 'GET' && url.pathname === '/v4/twins') return twins();
		}
		if (url.origin === `https://${ITEM_TWIN}` && url.searchParams.get('apiKey') === KEY) {
			if (method === 'GET' && url.pathname === `/dq/${DQ}`) return balance();
			if (method === 'POST' && url.pathname === `/dq/${DQ}/transfer`) return transfer();
		}
		throw new Error(`A test made a request it did not expect: ${method} ${url.origin}`);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

/** Asks for the refund of 2.10 to the test contractor's agent wallet, unless told otherwise. */
async function refund(change: Partial<ItemTwinRefundRequest> = {}) {
	const beforeSending = vi.fn(async (_dq: string) => true);
	const account = createMerchantAccount({
		paymentApiUrl: API,
		clientId: 'test-account-client',
		clientSecret: 'test-account-secret'
	});
	const outcome = account
		.refundTestPersonFromItemTwin({
			commodityHash: HASH,
			party: { email: TEST_EMAIL, agentWalletHostname: agentWalletHostnameSchema.parse(AGENT) },
			amount: 2100,
			beforeSending,
			...change
		})
		.then(
			(result) => ({ result, error: null }),
			(error: unknown) => ({ result: null, error })
		);
	return { ...(await outcome), beforeSending };
}

/** Everything a caller could see or keep of one refund, as text. */
function everythingThatCameOut(outcome: { result: unknown; error: unknown }): string {
	const { error } = outcome;
	const thrown =
		error instanceof Error
			? `${error.name} ${error.message} ${error.stack ?? ''} ${String(error.cause)} ${JSON.stringify(error)}`
			: String(error);
	return `${JSON.stringify(outcome.result)} ${thrown} ${logged}`;
}

describe('who is an end-to-end test person', () => {
	it('is decided by the email domain alone, whatever the letter case', () => {
		expect(E2E_TEST_EMAIL_DOMAIN).toBe('e2e.m.todaq.net');
		for (const email of [
			'contractor@e2e.m.todaq.net',
			'Confirmer+run42@E2E.M.Todaq.NET',
			'a@e2e.m.todaq.net'
		]) {
			expect(isEndToEndTestEmail(email), email).toBe(true);
		}
	});

	it('is nobody at any other domain, however close', () => {
		for (const email of [
			'site@coralridgebuilders.example',
			'someone@m.todaq.net',
			'someone@todaq.net',
			'someone@sub.e2e.m.todaq.net',
			'someone@note2e.m.todaq.net',
			'someone@e2e.m.todaq.net.example',
			'someone@e2e.m.todaq.net ',
			'someone@e2e.m.todaq.net.',
			'someone@e2e-m.todaq.net',
			'e2e.m.todaq.net@example.org',
			'someone@example.org@e2e.m.todaq.net',
			'@e2e.m.todaq.net',
			'e2e.m.todaq.net',
			''
		]) {
			expect(isEndToEndTestEmail(email), email).toBe(false);
		}
	});
});

describe('a wallet hostname', () => {
	it('is exactly what Qatom accepts in an address', () => {
		expect(isWalletHostname('agent0001.micro.biz.todaq.net')).toBe(true);
		expect(isWalletHostname('a-1.biz.todaq.net')).toBe(true);
		for (const hostname of [
			'biz.todaq.net',
			'Agent0001.micro.biz.todaq.net',
			'agent0001.micro.biz.todaq.net.evil.example',
			'agent0001.micro.biz.todaq.net/x',
			'agent0001.micro.biz.todaq.net:8443',
			'evil.example/.biz.todaq.net',
			'evil.example#.biz.todaq.net',
			'user@evil.example?.biz.todaq.net',
			'agent0001.wallets.tejido.example',
			'agent0001.biz.todaq.net\n',
			`${'a'.repeat(250)}.biz.todaq.net`,
			''
		]) {
			expect(isWalletHostname(hostname), hostname).toBe(false);
		}
	});
});

describe('a refund to a test person', () => {
	it('reads the twin and its key, checks the balance, then sends one transfer to the agent wallet', async () => {
		const { result, error, beforeSending } = await refund();

		expect(error).toBeNull();
		expect(result).toEqual({ outcome: 'sent' });
		expect(beforeSending).toHaveBeenCalledExactlyOnceWith(DQ);
		expect(requests.map(({ method, url }) => `${method} ${url.replace(KEY, '<key>')}`)).toEqual([
			`POST ${API}/v4/account/oauth/token`,
			`GET ${API}/v4/commodity/${HASH}/transactions`,
			`GET ${API}/v4/twins`,
			`GET https://${ITEM_TWIN}/dq/${DQ}?apiKey=<key>`,
			`POST https://${ITEM_TWIN}/dq/${DQ}/transfer?apiKey=<key>`
		]);
		// Decimal USD-TDN: 2100 thousandths go out as 2.1, to the AGENT wallet's address.
		expect(transfers()[0]!.body).toEqual({ amount: 2.1, destination: `https://${AGENT}` });
	});

	it('uses the merchant account token for Qatom and sends no token to the twin', async () => {
		await refund();
		const twinsRead = requests.find(({ url }) => url === `${API}/v4/twins`)!;
		expect(twinsRead.authorization).toBe(`Bearer ${TOKEN}`);
		for (const request of twinRequests()) expect(request.authorization).toBeNull();
	});

	it('sends 1.00 as 1 and 0.10 as 0.1', async () => {
		await refund({ amount: 1000 });
		await refund({ amount: 100 });
		expect(transfers().map(({ body }) => body)).toEqual([
			{ amount: 1, destination: `https://${AGENT}` },
			{ amount: 0.1, destination: `https://${AGENT}` }
		]);
	});

	it('records before it sends: the caller is asked after the balance and before the transfer', async () => {
		const order: string[] = [];
		transfer = () => {
			order.push('transfer');
			return Response.json({});
		};
		await refund({
			beforeSending: async () => {
				order.push(`asked after ${requests.length} requests`);
				return true;
			}
		});
		expect(order).toEqual(['asked after 4 requests', 'transfer']);
	});

	it('counts any OK answer as sent, whatever its body', async () => {
		for (const answer of [
			() => new Response('not json at all', { status: 200 }),
			() => new Response(null, { status: 204 }),
			() => Response.json({ error: 'looks bad but is 201' }, { status: 201 })
		]) {
			transfer = answer;
			expect((await refund()).result).toEqual({ outcome: 'sent' });
		}
	});

	it('reads the twin and its key again for every refund: nothing is remembered', async () => {
		const account = createMerchantAccount({
			paymentApiUrl: API,
			clientId: 'test-account-client',
			clientSecret: 'test-account-secret'
		});
		const request: ItemTwinRefundRequest = {
			commodityHash: HASH,
			party: { email: TEST_EMAIL, agentWalletHostname: agentWalletHostnameSchema.parse(AGENT) },
			amount: 100,
			beforeSending: async () => true
		};
		await account.refundTestPersonFromItemTwin(request);
		// Qatom now withholds the key. A remembered one would still send.
		twins = () => Response.json({ twins: [{ id: 2, key: null, hostname: ITEM_TWIN }] });
		const second = await account.refundTestPersonFromItemTwin(request);

		expect(second).toEqual({ outcome: 'not_sent', reason: 'item_twin_key_withheld' });
		expect(requests.filter(({ url }) => url === `${API}/v4/twins`)).toHaveLength(2);
		expect(transfers()).toHaveLength(1);
	});
});

describe('who it refuses', () => {
	it('refuses anyone who is not a test person before asking Qatom anything', async () => {
		for (const email of [
			'site@coralridgebuilders.example',
			'someone@sub.e2e.m.todaq.net',
			'someone@e2e.m.todaq.net.example',
			''
		]) {
			const { result, beforeSending } = await refund({
				party: { email, agentWalletHostname: agentWalletHostnameSchema.parse(AGENT) }
			});
			expect(result, email).toEqual({ outcome: 'not_sent', reason: 'not_a_test_person' });
			expect(beforeSending).not.toHaveBeenCalled();
		}
		expect(requests).toEqual([]);
	});

	it('refuses a recipient that is not a wallet hostname, before asking Qatom anything', async () => {
		for (const hostname of [
			'agent0001.wallets.tejido.example',
			'agent0001.micro.biz.todaq.net.evil.example',
			'evil.example'
		]) {
			const { result } = await refund({
				party: {
					email: TEST_EMAIL,
					agentWalletHostname: agentWalletHostnameSchema.parse(hostname)
				}
			});
			expect(result, hostname).toEqual({ outcome: 'not_sent', reason: 'recipient_not_a_wallet' });
		}
		expect(requests).toEqual([]);
	});

	it('refuses an amount that is not a positive whole number, before asking Qatom anything', async () => {
		for (const amount of [0, -100, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect((await refund({ amount })).error, String(amount)).toBeInstanceOf(RangeError);
		}
		expect(requests).toEqual([]);
	});
});

describe('when the twin cannot be used, the key goes nowhere', () => {
	const hostnames = () => new Set(requests.map(({ url }) => new URL(url).hostname));

	it('never calls a twin whose hostname is not a wallet hostname', async () => {
		for (const hostname of [
			'evil.example',
			'item0001.micro.biz.todaq.net.evil.example',
			'evil.example/.biz.todaq.net',
			'ITEM0001.micro.biz.todaq.net'
		]) {
			ledger = () =>
				Response.json({ commodity: { dq: DQ, hostname }, calculation: { transactions: [] } });
			// Even if Qatom's list of twins offered a key for that hostname.
			twins = () => Response.json({ twins: [{ id: 2, key: KEY, hostname }] });
			const { result, beforeSending } = await refund();
			expect(result, hostname).toEqual({ outcome: 'not_sent', reason: 'item_twin_not_a_wallet' });
			expect(beforeSending).not.toHaveBeenCalled();
		}
		// Only Qatom itself was asked, and only for the ledger: the list of twins, and so the
		// key, was never read.
		expect(hostnames()).toEqual(new Set([new URL(API).hostname]));
		expect(requests.some(({ url }) => url.endsWith('/v4/twins'))).toBe(false);
	});

	it('sends nothing when the ledger names no twin or no digital quantity', async () => {
		ledger = () => Response.json({ commodity: { dq: DQ }, calculation: { transactions: [] } });
		expect((await refund()).result).toEqual({ outcome: 'not_sent', reason: 'item_twin_not_named' });
		ledger = () =>
			Response.json({ commodity: { hostname: ITEM_TWIN }, calculation: { transactions: [] } });
		expect((await refund()).result).toEqual({ outcome: 'not_sent', reason: 'no_dq' });
		ledger = () =>
			Response.json({
				commodity: { hostname: ITEM_TWIN, dq: '../x' },
				calculation: { transactions: [] }
			});
		expect((await refund()).result).toEqual({ outcome: 'not_sent', reason: 'no_dq' });
		expect(twinRequests()).toEqual([]);
	});

	it('sends nothing when the recipient is the item twin itself', async () => {
		const { result } = await refund({
			party: { email: TEST_EMAIL, agentWalletHostname: agentWalletHostnameSchema.parse(ITEM_TWIN) }
		});
		expect(result).toEqual({ outcome: 'not_sent', reason: 'recipient_is_the_item_twin' });
		expect(twinRequests()).toEqual([]);
	});

	it('sends nothing when the account does not manage that twin exactly once', async () => {
		twins = () => Response.json({ twins: [{ id: 1, key: KEY, hostname: 'other.biz.todaq.net' }] });
		expect((await refund()).result).toEqual({
			outcome: 'not_sent',
			reason: 'item_twin_not_managed'
		});
		twins = () =>
			Response.json({
				twins: [
					{ id: 1, key: KEY, hostname: ITEM_TWIN },
					{ id: 2, key: 'second', hostname: ITEM_TWIN }
				]
			});
		expect((await refund()).result).toEqual({
			outcome: 'not_sent',
			reason: 'item_twin_not_managed'
		});
		expect(twinRequests()).toEqual([]);
	});

	it('sends nothing when Qatom withholds the key', async () => {
		for (const key of [null, '', undefined]) {
			twins = () => Response.json({ twins: [{ id: 2, key, hostname: ITEM_TWIN }] });
			expect((await refund()).result).toEqual({
				outcome: 'not_sent',
				reason: 'item_twin_key_withheld'
			});
		}
		expect(twinRequests()).toEqual([]);
	});

	it('sends nothing when the twin holds less than the amount', async () => {
		balance = () => Response.json({ balance: 2.099 });
		const { result, beforeSending } = await refund();
		expect(result).toEqual({ outcome: 'not_sent', reason: 'item_twin_balance_too_low' });
		expect(beforeSending).not.toHaveBeenCalled();
		expect(transfers()).toEqual([]);
	});

	it('sends exactly the balance when the twin holds exactly the amount', async () => {
		balance = () => Response.json({ balance: 2.1 });
		expect((await refund()).result).toEqual({ outcome: 'sent' });
	});

	it('sends nothing when the caller stops it', async () => {
		const { result } = await refund({ beforeSending: async () => false });
		expect(result).toEqual({ outcome: 'not_sent', reason: 'stopped_by_caller' });
		expect(transfers()).toEqual([]);
	});

	it('fails, having sent nothing, when Qatom or the balance cannot be read', async () => {
		twins = () => Response.json({ error: 'nope' }, { status: 503 });
		let outcome = await refund();
		expect(outcome.error).toBeInstanceOf(QatomError);
		expect(outcome.beforeSending).not.toHaveBeenCalled();

		twins = () => Response.json({ unexpected: true });
		expect((await refund()).error).toBeInstanceOf(QatomError);

		twins = () => Response.json({ twins: [{ id: 2, key: KEY, hostname: ITEM_TWIN }] });
		balance = () => Response.json({ balance: 'lots' });
		outcome = await refund();
		expect(outcome.error).toBeInstanceOf(QatomError);
		expect(outcome.beforeSending).not.toHaveBeenCalled();
		expect(transfers()).toEqual([]);
	});
});

describe('what became of the transfer', () => {
	it('is refused, with the status only, for any answer that is not OK', async () => {
		for (const status of [301, 400, 401, 402, 403, 404, 409, 422, 500, 502, 503]) {
			transfer = () =>
				new Response(`refused https://${ITEM_TWIN}/dq/${DQ}/transfer?apiKey=${KEY}`, {
					status,
					headers: status === 301 ? { location: 'https://evil.example/' } : {}
				});
			const outcome = await refund();
			expect(outcome.result, String(status)).toEqual({ outcome: 'refused', status });
			expect(everythingThatCameOut(outcome)).not.toContain(KEY);
		}
		// A redirect was not followed: the key went to the twin and nowhere else.
		expect(requests.some(({ url }) => url.includes('evil.example'))).toBe(false);
	});

	it('is unknown when no answer arrives, and is not sent again', async () => {
		transfer = () => {
			throw new TypeError('socket hang up');
		};
		expect((await refund()).result).toEqual({ outcome: 'unknown', failure: 'no_answer' });

		transfer = () => {
			throw new DOMException('The operation timed out.', 'TimeoutError');
		};
		expect((await refund()).result).toEqual({ outcome: 'unknown', failure: 'timeout' });
		// One POST per refund asked for: never a second try.
		expect(transfers()).toHaveLength(2);
	});
});

describe('the key never comes out', () => {
	const addressWithKey = (path: string) => `https://${ITEM_TWIN}${path}?apiKey=${KEY}`;

	it('not when the transfer fails with the address in its message', async () => {
		transfer = () => {
			throw new TypeError(`fetch failed: ${addressWithKey(`/dq/${DQ}/transfer`)}`, {
				cause: new Error(`connect ECONNRESET ${addressWithKey(`/dq/${DQ}/transfer`)}`)
			});
		};
		const outcome = await refund();

		expect(outcome.result).toEqual({ outcome: 'unknown', failure: 'no_answer' });
		const out = everythingThatCameOut(outcome);
		expect(out).not.toContain(KEY);
		expect(out).not.toContain('apiKey');
		expect(out).not.toContain(ITEM_TWIN);
	});

	it('not when the balance read fails with the address in its message', async () => {
		balance = () => {
			throw new TypeError(`fetch failed: ${addressWithKey(`/dq/${DQ}`)}`, {
				cause: new Error(`getaddrinfo ENOTFOUND ${addressWithKey(`/dq/${DQ}`)}`)
			});
		};
		const outcome = await refund();

		expect(outcome.error).toBeInstanceOf(QatomError);
		expect((outcome.error as QatomError).message).toBe(
			'Qatom account.item-twin-balance could not be reached'
		);
		expect((outcome.error as QatomError).cause).toBeUndefined();
		const out = everythingThatCameOut(outcome);
		expect(out).not.toContain(KEY);
		expect(out).not.toContain('apiKey');
		expect(out).not.toContain(ITEM_TWIN);
		expect(transfers()).toEqual([]);
	});

	it('not when the twin answers the balance read with an error that echoes the address', async () => {
		balance = () =>
			Response.json(
				{ error: `bad key ${KEY}`, message: `GET ${addressWithKey(`/dq/${DQ}`)} refused` },
				{ status: 403 }
			);
		const outcome = await refund();

		expect((outcome.error as QatomError).message).toBe(
			'Qatom account.item-twin-balance failed with 403'
		);
		expect(everythingThatCameOut(outcome)).not.toContain(KEY);
	});

	it('not in the result, and nothing is logged, when all goes well or the twin refuses', async () => {
		const sent = await refund();
		transfer = () => Response.json({ error: KEY }, { status: 500 });
		const refused = await refund();

		for (const outcome of [sent, refused]) {
			const out = everythingThatCameOut(outcome);
			expect(out).not.toContain(KEY);
			expect(out).not.toContain(ITEM_TWIN);
		}
		expect(logged).toBe('');
	});
});
