// A donation the automatic paid tests make is sent back to the test person's wallet it was
// paid from, out of the donation item's own twin, and taken out of the campaign's total. And
// the proof that nobody else's donation is touched and nobody else is sent money.
//
// Calls the endpoint's own handler against a real, migrated, seeded local D1.
//
// NOTHING HERE REACHES QATOM, A TWIN OR ANY NETWORK, AND NOTHING MOVES MONEY. `fetch` is
// replaced for every test, and a request the test did not expect fails it. The merchant
// account is the real client from @tejido/qatom, pointed at an address that does not exist.
import {
	agentWalletHostnameSchema,
	CHECKIN_SECRET_HEADER,
	primaryWalletHostnameSchema
} from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaigns,
	donations,
	donationUndos,
	getCampaign,
	getFundingSummary,
	parties,
	recordDonation
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONSIDER_FOR_MS,
	PASS_LIMIT,
	type DonationUndoReport
} from '#lib/server/backend/test-donation-undos.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const QATOM = 'https://qatom.invalid';
const SITE = 'https://tejido.example';
const DQ = '41dq0000000000000000000000000000000000000000000000000000000000000a';

/** A real campaign (the fixture's), and one the paid tests own. */
const REAL_CAMPAIGN = fixtures.campaign.id;
const TEST_CAMPAIGN = 'cmp-e2e-run-1';

/** The donation items: the amount in USD-TDN, the ledger's hash, the item's twin and its key. */
const ITEMS = {
	1: {
		hash: '11111111-5d47-4a9b-8e21-0c6d9f4a7b12',
		twin: 'give0001.micro.biz.todaq.net',
		key: 'give-1-key-SECRET-1a2b'
	},
	10: {
		hash: '10101010-2b36-4f58-a0c9-7e5b3d1f6a24',
		twin: 'give0010.micro.biz.todaq.net',
		key: 'give-10-key-SECRET-3c4d'
	},
	25: {
		hash: '25252525-2b36-4f58-a0c9-7e5b3d1f6a24',
		twin: 'give0025.micro.biz.todaq.net',
		key: 'give-25-key-SECRET-5e6f'
	}
} as const;
type Usd = keyof typeof ITEMS;
const usdOf = (value: string | undefined) =>
	([1, 10, 25] as const).find((usd) => value === ITEMS[usd].hash || value === ITEMS[usd].twin);

/** The test people's wallets, and a stranger's. */
const TEST_PRIMARY = 'e2e-contractor-primary.micro.biz.todaq.net';
const TEST_AGENT = 'e2e-contractor-agent.micro.biz.todaq.net';
const STRANGER = 'a-real-donor.micro.biz.todaq.net';

const templateParty = fixtures.parties[0]!;

interface LedgerRow {
	twistId: string;
	timestamp: string;
	amount: number;
	fromAddress: string;
	destinationAddress?: string;
	operation: string;
}

let test: TestDatabase;
let requests: { method: string; origin: string; path: string; body: unknown }[];
let logged: string;
/** The rows on each donation item's ledger. */
let ledgers: Record<Usd, LedgerRow[]>;
/** What each item twin "holds", in decimal USD-TDN. */
let balances: Record<Usd, number>;
let answerTwinTransfer: () => Response | Promise<Response>;
let answerItems: () => Response;
let number: number;

const twinTransfers = () =>
	requests.filter(({ method, path }) => method === 'POST' && path === `/dq/${DQ}/transfer`);
const twinCalls = () => requests.filter(({ origin }) => origin !== QATOM);

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	requests = [];
	logged = '';
	number = 0;
	ledgers = { 1: [], 10: [], 25: [] };
	balances = { 1: 50, 10: 50, 25: 50 };
	answerTwinTransfer = () => Response.json({ ok: true });
	answerItems = () =>
		Response.json({
			items: ([1, 10, 25] as const).map((usd) => ({
				id: 200 + usd,
				active: true,
				commodity_id: 500 + usd,
				commodity_hash: ITEMS[usd].hash,
				commodity_cost: usd,
				external_endpoint: `${SITE}/api/donations/${usd}`
			}))
		});

	for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
			logged += `${parts.map(String).join(' ')}\n`;
		});
	}

	vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input);
		const method = init?.method ?? 'GET';
		const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
		requests.push({ method, origin: url.origin, path: url.pathname, body });

		if (url.origin === QATOM) {
			if (method === 'POST' && url.pathname === '/v4/account/oauth/token') {
				return Response.json({ access_token: 'test-account-token', expires_at: '4102444800' });
			}
			if (method === 'GET' && url.pathname === '/v4/catalog/items') return answerItems();
			const usd = usdOf(/^\/v4\/commodity\/([0-9a-f-]+)\/transactions$/.exec(url.pathname)?.[1]);
			if (method === 'GET' && usd !== undefined) {
				return Response.json({
					commodity: { dq: DQ, hostname: ITEMS[usd].twin },
					calculation: { transactions: ledgers[usd] }
				});
			}
			if (method === 'GET' && url.pathname === '/v4/twins') {
				return Response.json({
					twins: [
						{ id: 1, key: 'main-key', hostname: 'tejido-main.biz.todaq.net', is_primary: true },
						...([1, 10, 25] as const).map((usd) => ({
							id: 10 + usd,
							key: ITEMS[usd].key,
							hostname: ITEMS[usd].twin,
							twin_type: 'provider'
						}))
					]
				});
			}
		}
		const usd = usdOf(url.hostname);
		if (usd !== undefined && url.searchParams.get('apiKey') === ITEMS[usd].key) {
			if (method === 'GET' && url.pathname === `/dq/${DQ}`) {
				return Response.json({ balance: balances[usd] });
			}
			if (method === 'POST' && url.pathname === `/dq/${DQ}/transfer`) return answerTwinTransfer();
		}
		throw new Error(`A test made a request it did not expect: ${method} ${url.origin}`);
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await test.destroy();
});

// --- Setting the scene -------------------------------------------------------------------

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A campaign like the fixture's, in `funding`, made by `creatorEmail`. */
async function addCampaign(id: string, creatorEmail: string, fundingGoal: number | null = null) {
	const [template] = await test.db.select().from(campaigns).where(eq(campaigns.id, REAL_CAMPAIGN));
	await test.db
		.insert(campaigns)
		.values({ ...template!, id, creatorEmail, status: 'funding', fundingGoal });
}

/** Adds a party to the fixture campaign: wallets are registered to people, on any campaign. */
async function addParty(
	id: string,
	email: string,
	wallets: { agent?: string | null; primary?: string | null }
) {
	await test.db.insert(parties).values({
		...templateParty,
		id,
		name: id,
		email,
		reporterCode: `rc_${id
			.replace(/[^a-z]/g, '')
			.padEnd(20, 'x')
			.slice(0, 20)}`,
		agentWalletHostname: wallets.agent ? agentWalletHostnameSchema.parse(wallets.agent) : null,
		primaryWalletHostname: wallets.primary
			? primaryWalletHostnameSchema.parse(wallets.primary)
			: null
	});
}

/** The test campaign and the test contractor, signed in with Qatom. */
async function testWorld() {
	await addCampaign(TEST_CAMPAIGN, 'e2e-creator@e2e.m.todaq.net');
	await addParty('e2e-contractor', 'tejido-contractor@e2e.m.todaq.net', {
		agent: TEST_AGENT,
		primary: TEST_PRIMARY
	});
}

/** Records a donation as the donation endpoint does. Answers its id. */
async function donate(campaignId: string, usd: number, receivedAgoMs = 30_000) {
	number += 1;
	const id = `don_test_${number}`;
	await recordDonation(test.db, {
		id,
		campaignId,
		amount: usd * 1000,
		paymentDigest: null,
		receivedAt: ago(receivedAgoMs)
	});
	return id;
}

/** Puts a payment on a donation item's ledger, as Qatom lists one. Answers its id. */
function pay(usd: Usd, from: string, paidAgoMs = 40_000, change: Partial<LedgerRow> = {}) {
	number += 1;
	const row: LedgerRow = {
		twistId: `41twist${String(number).padStart(4, '0')}`,
		timestamp: ago(paidAgoMs),
		amount: usd,
		fromAddress: from,
		destinationAddress: ITEMS[usd].twin,
		operation: 'receive',
		...change
	};
	ledgers[usd].push(row);
	return row.twistId;
}

/** What the paid tests do: the test contractor gives 1.00 to the test campaign. */
async function testDonation(usd: Usd = 1) {
	await testWorld();
	const twistId = pay(usd, TEST_PRIMARY);
	return { donationId: await donate(TEST_CAMPAIGN, usd), twistId };
}

// --- Calling the endpoint ----------------------------------------------------------------

async function pass(headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }) {
	const account = createMerchantAccount({
		paymentApiUrl: QATOM,
		clientId: 'test-account-client',
		clientSecret: 'test-account-secret'
	});
	const event = {
		request: new Request('http://localhost/api/test-donation-undos', { method: 'POST', headers }),
		locals: {
			ctx: {
				db: test.db,
				config: { CHECKIN_SHARED_SECRET: SECRET, WEB_OIDC_REDIRECT_URI: `${SITE}/auth/callback` },
				qatom: { account }
			},
			session: null
		}
	};
	const response = await POST(event as unknown as Parameters<typeof POST>[0]);
	const text = await response.text();
	return { status: response.status, text, report: JSON.parse(text) as DonationUndoReport };
}

const undos = () => test.db.select().from(donationUndos);
const reasons = (report: DonationUndoReport) => report.skipped.map(({ reason }) => reason);
async function totals(campaignId: string) {
	const summary = await getFundingSummary(test.db, (await getCampaign(test.db, campaignId))!);
	return summary.state === 'known'
		? { raised: summary.raised, donations: summary.donations }
		: null;
}

// -----------------------------------------------------------------------------------------

describe('who may ask', () => {
	it('refuses a caller without the shared secret, before anything else', async () => {
		await testDonation();
		expect((await pass({})).status).toBe(401);
		expect((await pass({ [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect(requests).toEqual([]);
		expect(await undos()).toEqual([]);
	});
});

describe('a donation the paid tests made', () => {
	it('is sent back once, to the primary wallet it was paid from, out of that item’s twin', async () => {
		const { donationId, twistId } = await testDonation();
		const { status, report } = await pass();

		expect(status).toBe(200);
		expect(report.undone).toEqual([
			{ donation_id: donationId, campaign_id: TEST_CAMPAIGN, amount: 1000, amount_display: '1.00' }
		]);
		expect(report.skipped).toEqual([]);
		expect(report.asked_total).toBe(1000);
		expect(report.needs_a_person).toBe(false);

		// Exactly the donation's amount, in decimal USD-TDN, from the 1.00 item's own twin.
		expect(twinTransfers()).toEqual([
			{
				method: 'POST',
				origin: `https://${ITEMS[1].twin}`,
				path: `/dq/${DQ}/transfer`,
				body: { amount: 1, destination: `https://${TEST_PRIMARY}` }
			}
		]);
		// Never Qatom's own transfer, which pays from the merchant account's main wallet.
		expect(requests.filter(({ path }) => path === '/v4/transfer')).toEqual([]);

		// What is kept: the ledger payment's id, the amount and the state. Nothing else.
		expect(await undos()).toEqual([
			{
				donationId,
				twistId,
				amount: 1000,
				status: 'sent',
				statusReason: null,
				startedAt: expect.any(String) as string,
				settledAt: expect.any(String) as string
			}
		]);
	});

	it('is out of the campaign’s total and count afterwards, and its row is kept', async () => {
		await testWorld();
		// A donation from before, long past the hour: it is not looked at and still counts.
		await donate(TEST_CAMPAIGN, 10, CONSIDER_FOR_MS + 60_000);
		pay(1, TEST_PRIMARY);
		const donationId = await donate(TEST_CAMPAIGN, 1);
		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 11_000, donations: 2 });

		await pass();

		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 10_000, donations: 1 });
		const rows = await test.db.select().from(donations).where(eq(donations.id, donationId));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ campaignId: TEST_CAMPAIGN, amount: 1000 });
	});

	it('a campaign whose only donation was undone reads as it did before any donation', async () => {
		await testWorld();
		const before = await totals(TEST_CAMPAIGN);
		pay(1, TEST_PRIMARY);
		await donate(TEST_CAMPAIGN, 1);
		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });

		await pass();

		expect(await totals(TEST_CAMPAIGN)).toEqual(before);
	});

	it('still counts while its undo is anything but sent', async () => {
		const { donationId } = await testDonation();
		answerTwinTransfer = () => Response.json({}, { status: 500 });
		await pass();

		expect((await undos()).map((row) => [row.donationId, row.status])).toEqual([
			[donationId, 'failed']
		]);
		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });
	});

	it('an undone donation no longer counts towards the goal of a later one', async () => {
		await addCampaign(TEST_CAMPAIGN, 'e2e-creator@e2e.m.todaq.net', 10_000);
		await addParty('e2e-contractor', 'tejido-contractor@e2e.m.todaq.net', {
			primary: TEST_PRIMARY
		});
		pay(1, TEST_PRIMARY);
		await donate(TEST_CAMPAIGN, 1);
		await pass();

		// 9.00 more would have met the goal of 10.00 with the undone 1.00. It does not.
		await donate(TEST_CAMPAIGN, 9, CONSIDER_FOR_MS + 60_000);
		expect((await getCampaign(test.db, TEST_CAMPAIGN))!.status).toBe('funding');
	});

	it('goes back to the agent wallet when that is the wallet it was paid from', async () => {
		await testWorld();
		pay(1, TEST_AGENT);
		await donate(TEST_CAMPAIGN, 1);
		await pass();

		expect(twinTransfers().map(({ body }) => body)).toEqual([
			{ amount: 1, destination: `https://${TEST_AGENT}` }
		]);
	});

	it('is found when the ledger writes the paying wallet as a twin URL', async () => {
		await testWorld();
		pay(1, `https://${TEST_PRIMARY}`);
		await donate(TEST_CAMPAIGN, 1);
		const { report } = await pass();

		expect(report.undone).toHaveLength(1);
		expect(twinTransfers().map(({ body }) => body)).toEqual([
			{ amount: 1, destination: `https://${TEST_PRIMARY}` }
		]);
	});

	it('a 10.00 donation comes out of the 10.00 item’s twin, not another', async () => {
		await testDonation(10);
		// A 1.00 payment from the same wallet at the same moment is not its payment.
		pay(1, TEST_PRIMARY);
		await pass();

		expect(twinTransfers().map(({ origin, body }) => ({ origin, body }))).toEqual([
			{
				origin: `https://${ITEMS[10].twin}`,
				body: { amount: 10, destination: `https://${TEST_PRIMARY}` }
			}
		]);
	});
});

describe('once only', () => {
	it('a second pass, and a third, send nothing', async () => {
		await testDonation();
		await pass();
		const again = await pass();
		await pass();

		expect(again.report.undone).toEqual([]);
		expect(again.report.skipped).toEqual([]);
		expect(twinTransfers()).toHaveLength(1);
		expect(await undos()).toHaveLength(1);
	});

	it('two passes at the same moment send it once', async () => {
		await testDonation();
		const [first, second] = await Promise.all([pass(), pass()]);

		expect(twinTransfers()).toHaveLength(1);
		expect(first.report.undone.length + second.report.undone.length).toBe(1);
		expect(await undos()).toHaveLength(1);
	});

	it('one payment is never sent back for two donations', async () => {
		const { donationId, twistId } = await testDonation();
		await pass();
		// A second donation of the same amount, a moment later, with no payment of its own:
		// the payment already sent back is not offered to it.
		const second = await donate(TEST_CAMPAIGN, 1, 10_000);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['no_payment_from_a_test_wallet']);
		expect(report.skipped[0]!.donation_id).toBe(second);
		expect(twinTransfers()).toHaveLength(1);
		expect(await undos()).toEqual([expect.objectContaining({ donationId, twistId })]);
	});

	it('the table itself refuses a second undo of a donation, or of a payment', async () => {
		const { donationId, twistId } = await testDonation();
		const other = await donate(TEST_CAMPAIGN, 1);
		const row = { amount: 1000, status: 'started' as const, startedAt: ago(0) };
		await test.db.insert(donationUndos).values({ ...row, donationId, twistId });

		await expect(
			test.db.insert(donationUndos).values({ ...row, donationId, twistId: 'another' })
		).rejects.toThrow();
		await expect(
			test.db.insert(donationUndos).values({ ...row, donationId: other, twistId })
		).rejects.toThrow();
	});
});

describe('nobody else', () => {
	it('never touches a real campaign’s donation: no request at all', async () => {
		await addParty('e2e-contractor', 'tejido-contractor@e2e.m.todaq.net', {
			primary: TEST_PRIMARY
		});
		// Even paid by a test person, from their registered wallet.
		pay(1, TEST_PRIMARY);
		await donate(REAL_CAMPAIGN, 1);
		const { report } = await pass();

		expect(report.undone).toEqual([]);
		expect(report.skipped).toEqual([]);
		expect(requests).toEqual([]);
		expect(await undos()).toEqual([]);
		expect(await totals(REAL_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });
	});

	it('never touches a campaign whose creator’s domain only looks like the test inbox', async () => {
		await addParty('e2e-contractor', 'tejido-contractor@e2e.m.todaq.net', {
			primary: TEST_PRIMARY
		});
		const lookAlikes = [
			'creator@e2e.m.todaq.net.example',
			'creator@x.e2e.m.todaq.net',
			'creator@note2e.m.todaq.net',
			'creator@e2e.m.todaq.net@real.example',
			'creator@e2e-m-todaq.net',
			'creator@e2eXm.todaq.net'
		];
		for (const [index, email] of lookAlikes.entries()) {
			await addCampaign(`cmp-look-${index}`, email);
			pay(1, TEST_PRIMARY, 40_000 + index);
			await donate(`cmp-look-${index}`, 1);
		}
		const { report } = await pass();

		expect(report.undone).toEqual([]);
		expect(report.skipped).toEqual([]);
		expect(requests).toEqual([]);
		expect(await undos()).toEqual([]);
	});

	it('a test campaign’s donation paid from an unknown wallet is never sent back', async () => {
		await testWorld();
		pay(1, STRANGER);
		const donationId = await donate(TEST_CAMPAIGN, 1);
		const { report } = await pass();

		expect(report.undone).toEqual([]);
		expect(report.skipped).toEqual([
			expect.objectContaining({ donation_id: donationId, reason: 'no_payment_from_a_test_wallet' })
		]);
		expect(twinCalls()).toEqual([]);
		expect(await undos()).toEqual([]);
		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });
	});

	it('nor one paid from a wallet registered to a real party', async () => {
		await testWorld();
		await addParty('real-supplier', 'supplier@builders.example', { primary: STRANGER });
		pay(1, STRANGER);
		await donate(TEST_CAMPAIGN, 1);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['no_payment_from_a_test_wallet']);
		expect(twinCalls()).toEqual([]);
	});

	it('nor one paid from a wallet registered to a look-alike of a test person', async () => {
		await testWorld();
		await addParty('look-alike', 'contractor@e2e.m.todaq.net.example', { primary: STRANGER });
		await addParty('look-alike-two', 'contractor@x.e2e.m.todaq.net', { agent: STRANGER });
		pay(1, STRANGER);
		await donate(TEST_CAMPAIGN, 1);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['no_payment_from_a_test_wallet']);
		expect(twinCalls()).toEqual([]);
	});

	it('nor one paid from a wallet a test person shares with anyone who is not one', async () => {
		await testWorld();
		await addParty('real-supplier', 'supplier@builders.example', { agent: TEST_PRIMARY });
		pay(1, TEST_PRIMARY);
		await donate(TEST_CAMPAIGN, 1);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['no_payment_from_a_test_wallet']);
		expect(twinCalls()).toEqual([]);
		expect(await undos()).toEqual([]);
	});

	it('nor when the paying address is not a wallet hostname, or nothing was paid in', async () => {
		await testWorld();
		// A 66-character address, money going out, another amount, another time.
		pay(1, `0x${'ab'.repeat(32)}`);
		pay(1, TEST_PRIMARY, 40_000, { operation: 'send' });
		pay(1, TEST_PRIMARY, 40_000, { operation: 'transfer' });
		pay(1, TEST_PRIMARY, 40_000, { amount: 10 });
		pay(1, TEST_PRIMARY, 30 * 60_000);
		pay(1, TEST_PRIMARY, -5 * 60_000);
		await donate(TEST_CAMPAIGN, 1);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['no_payment_from_a_test_wallet']);
		expect(twinCalls()).toEqual([]);
	});

	it('a test person’s donation to a real campaign is never taken for a test campaign’s', async () => {
		await testWorld();
		// The test person paid 1.00 to a REAL campaign; a stranger paid 1.00 to the test
		// campaign at the same moment. The one payment from a test wallet fits both donations.
		pay(1, TEST_PRIMARY);
		pay(1, STRANGER);
		await donate(REAL_CAMPAIGN, 1);
		await donate(TEST_CAMPAIGN, 1);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['ambiguous']);
		expect(twinCalls()).toEqual([]);
		expect(await undos()).toEqual([]);
		expect(await totals(REAL_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });
		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });
	});

	it('two payments that both fit one donation: nothing is sent', async () => {
		await testDonation();
		pay(1, TEST_AGENT);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['ambiguous']);
		expect(twinCalls()).toEqual([]);
	});

	it('the Qatom call itself refuses a payer who is not a test person', async () => {
		const account = createMerchantAccount({
			paymentApiUrl: QATOM,
			clientId: 'test-account-client',
			clientSecret: 'test-account-secret'
		});
		const beforeSending = vi.fn(async () => true);
		for (const email of ['donor@real.example', 'donor@e2e.m.todaq.net.example']) {
			const result = await account.returnTestDonationFromItemTwin({
				commodityHash: ITEMS[1].hash,
				payer: { email, walletHostname: primaryWalletHostnameSchema.parse(STRANGER) },
				amount: 1000,
				beforeSending
			});
			expect(result).toEqual({ outcome: 'not_sent', reason: 'not_a_test_person' });
		}
		expect(requests).toEqual([]);
		expect(beforeSending).not.toHaveBeenCalled();
	});
});

describe('which donations are looked at', () => {
	it('not one recorded more than an hour ago', async () => {
		await testWorld();
		pay(1, TEST_PRIMARY, CONSIDER_FOR_MS + 70_000);
		await donate(TEST_CAMPAIGN, 1, CONSIDER_FOR_MS + 60_000);
		const { report } = await pass();

		expect(report.undone).toEqual([]);
		expect(report.skipped).toEqual([]);
		expect(requests).toEqual([]);
	});

	it('an amount no donation item sells is skipped, with the reason', async () => {
		await testWorld();
		await donate(TEST_CAMPAIGN, 5);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['no_donation_item']);
		expect(twinCalls()).toEqual([]);
	});

	it('an item that calls another site is not a donation item of ours', async () => {
		await testDonation();
		answerItems = () =>
			Response.json({
				items: [
					{
						id: 201,
						active: true,
						commodity_id: 501,
						commodity_hash: ITEMS[1].hash,
						commodity_cost: 1,
						external_endpoint: 'https://elsewhere.example/api/donations/1'
					}
				]
			});
		const { report } = await pass();

		expect(reasons(report)).toEqual(['no_donation_item']);
		expect(twinCalls()).toEqual([]);
	});
});

describe('when the transfer does not go through', () => {
	it('a twin that refuses: recorded as failed, still counted, and never tried again', async () => {
		const { donationId } = await testDonation();
		answerTwinTransfer = () => Response.json({ error: 'no' }, { status: 403 });
		const first = await pass();
		answerTwinTransfer = () => Response.json({ ok: true });
		const second = await pass();
		await pass();

		expect(reasons(first.report)).toEqual(['transfer_refused']);
		expect(first.report.needs_a_person).toBe(true);
		expect(reasons(second.report)).toEqual(['undo_tried_before']);
		expect(twinTransfers()).toHaveLength(1);
		expect(await undos()).toEqual([
			expect.objectContaining({ donationId, status: 'failed', settledAt: expect.any(String) })
		]);
		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });
	});

	it('no answer: recorded as unknown, still counted, and never sent again', async () => {
		const { donationId } = await testDonation();
		answerTwinTransfer = () => {
			throw new TypeError('fetch failed');
		};
		const first = await pass();
		answerTwinTransfer = () => Response.json({ ok: true });
		const second = await pass();
		await pass();

		expect(reasons(first.report)).toEqual(['transfer_outcome_unknown']);
		expect(first.report.needs_a_person).toBe(true);
		expect(reasons(second.report)).toEqual(['undo_outcome_unknown']);
		expect(twinTransfers()).toHaveLength(1);
		expect(await undos()).toEqual([
			expect.objectContaining({ donationId, status: 'unknown', settledAt: null })
		]);
		expect(await totals(TEST_CAMPAIGN)).toEqual({ raised: 1000, donations: 1 });
	});

	it('a twin that cannot cover the amount: nothing sent or recorded, tried on a later pass', async () => {
		await testDonation();
		balances[1] = 0.5;
		const first = await pass();
		expect(reasons(first.report)).toEqual(['item_twin_balance_too_low']);
		expect(twinTransfers()).toEqual([]);
		expect(await undos()).toEqual([]);

		balances[1] = 1;
		const second = await pass();
		expect(second.report.undone).toHaveLength(1);
		expect(twinTransfers()).toHaveLength(1);
	});

	it('Qatom out of reach: nothing sent or recorded', async () => {
		await testDonation();
		answerItems = () => Response.json({ error: 'down' }, { status: 503 });
		const { report } = await pass();

		expect(reasons(report)).toEqual(['qatom_unavailable']);
		expect(twinCalls()).toEqual([]);
		expect(await undos()).toEqual([]);
	});
});

describe('the limit on one pass', () => {
	it('is 10.00', () => {
		expect(PASS_LIMIT).toBe(10_000);
	});

	it('stops a pass from asking for more than the limit; the rest waits for the next pass', async () => {
		await testWorld();
		// Twelve donations of 1.00, each with its own payment ten seconds before it, five
		// minutes apart: far enough for each payment to fit one donation only.
		for (let index = 0; index < 12; index += 1) {
			const receivedAgo = 30_000 + index * 5 * 60_000;
			pay(1, TEST_PRIMARY, receivedAgo + 10_000);
			await donate(TEST_CAMPAIGN, 1, receivedAgo);
		}
		const first = await pass();

		expect(first.report.undone).toHaveLength(10);
		expect(first.report.asked_total).toBe(10_000);
		expect(reasons(first.report)).toEqual(['pass_limit_reached', 'pass_limit_reached']);
		expect(twinTransfers()).toHaveLength(10);

		const second = await pass();
		expect(second.report.undone).toHaveLength(2);
		expect(twinTransfers()).toHaveLength(12);
	});

	it('counts what was asked for even when the outcome is unknown', async () => {
		await testDonation(10);
		pay(1, TEST_PRIMARY, 50_000);
		await donate(TEST_CAMPAIGN, 1, 45_000);
		answerTwinTransfer = () => {
			throw new TypeError('fetch failed');
		};
		const { report } = await pass();

		// The 1.00 (older) was asked for, then the 10.00 would pass the limit.
		expect(report.asked_total).toBe(1000);
		expect(reasons(report).sort()).toEqual(['pass_limit_reached', 'transfer_outcome_unknown']);
		expect(twinTransfers()).toHaveLength(1);
	});

	it('never sends back a donation that is by itself over the limit', async () => {
		await testDonation(25);
		const { report } = await pass();

		expect(reasons(report)).toEqual(['transfer_over_limit']);
		expect(report.needs_a_person).toBe(true);
		expect(twinCalls()).toEqual([]);
		expect(await undos()).toEqual([]);
	});
});

describe('the twin’s hostname and key, and every wallet, are kept nowhere', () => {
	const SECRETS = [
		...([1, 10, 25] as const).flatMap((usd) => [ITEMS[usd].key, ITEMS[usd].twin]),
		'apiKey',
		TEST_PRIMARY,
		TEST_AGENT
	];

	async function everythingStored(): Promise<string> {
		return JSON.stringify([
			await test.db.select().from(donationUndos),
			await test.db.select().from(donations)
		]);
	}

	it('not in the answer, the database or the logs when a donation is sent back', async () => {
		await testDonation();
		const { text, report } = await pass();

		expect(report.undone).toHaveLength(1);
		const out = `${text}\n${await everythingStored()}\n${logged}`;
		for (const secret of SECRETS) expect(out, secret).not.toContain(secret);
	});

	it('not when a twin refuses with an answer that echoes its own address', async () => {
		await testDonation();
		answerTwinTransfer = () =>
			Response.json(
				{ error: `POST https://${ITEMS[1].twin}/dq/${DQ}/transfer?apiKey=${ITEMS[1].key} no` },
				{ status: 403 }
			);
		const { text } = await pass();

		expect(logged).toContain('Test-donation undo refused by the twin');
		const out = `${text}\n${await everythingStored()}\n${logged}`;
		for (const secret of SECRETS) expect(out, secret).not.toContain(secret);
	});

	it('not when the connection fails with the address in its message', async () => {
		await testDonation();
		answerTwinTransfer = () => {
			throw new TypeError(
				`fetch failed: https://${ITEMS[1].twin}/dq/${DQ}/transfer?apiKey=${ITEMS[1].key}`
			);
		};
		const { text } = await pass();

		expect(logged).toContain('Test-donation undo outcome unknown');
		const out = `${text}\n${await everythingStored()}\n${logged}`;
		for (const secret of SECRETS) expect(out, secret).not.toContain(secret);
	});

	it('a donation nobody undid still holds no wallet and no payment id', async () => {
		await testWorld();
		pay(1, STRANGER);
		await donate(TEST_CAMPAIGN, 1);
		await donate(REAL_CAMPAIGN, 1);
		await pass();

		expect(await undos()).toEqual([]);
		expect(await everythingStored()).not.toContain(STRANGER);
		expect(await everythingStored()).not.toContain('41twist');
	});
});

describe('the line each pass writes to the logs', () => {
	const lines = () => logged.split('\n').filter((line) => line.startsWith('Test-donation undos:'));

	it('says how many were sent back and that nobody needs to look', async () => {
		await testDonation();
		await pass();

		expect(lines()).toEqual([
			'Test-donation undos: 1 sent back, 0 skipped, a person needs to look: no.'
		]);
	});

	it('is not written when there was nothing to consider', async () => {
		await donate(REAL_CAMPAIGN, 1);
		await pass();

		expect(lines()).toEqual([]);
		expect(logged).toBe('');
	});

	it('makes a pass that skipped everything visible, with the reasons and their counts', async () => {
		await testWorld();
		await donate(TEST_CAMPAIGN, 1);
		await donate(TEST_CAMPAIGN, 1);
		await donate(TEST_CAMPAIGN, 25);
		await pass();

		expect(lines()).toEqual([
			'Test-donation undos: 0 sent back, 3 skipped (no_payment_from_a_test_wallet 2, transfer_over_limit 1), a person needs to look: YES.'
		]);
	});
});
