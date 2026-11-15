// The one exception: the end-to-end test people's deposits go back to their AGENT wallets,
// out of the item's own twin. And the proof that nobody else can be refunded that way.
//
// Calls the two refund endpoints' own handlers against a real, migrated, seeded local D1.
//
// NOTHING HERE REACHES QATOM, A TWIN OR ANY NETWORK, AND NOTHING MOVES MONEY. `fetch` is
// replaced for every test, and a request the test did not expect fails it. The merchant
// account is the real client from @tejido/qatom, pointed at an address that does not exist.
import {
	agentWalletHostnameSchema,
	CHECKIN_SECRET_HEADER,
	DEPOSIT_AMOUNT,
	primaryWalletHostnameSchema,
	type EntryStatus
} from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaigns,
	deposits,
	entries,
	entryPurchases,
	listDeposits,
	listRefunds,
	milestones,
	parties,
	refundAttempts,
	refundDeposits,
	refunds
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefundReport } from '#lib/server/backend/refunds.ts';
import { reconcile, SHARED_ITEM_COMMODITY_ID } from '#lib/server/backend/reconciler.ts';
import {
	isDueForRefund,
	PASS_LIMIT,
	UNCONFIRMED_REFUND_AGE_MINUTES,
	type TestRefundReport
} from '#lib/server/backend/test-account-refunds.ts';
import { POST as postProductRefunds } from '../refunds/+server.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const QATOM = 'https://qatom.invalid';
const CAMPAIGN = fixtures.campaign.id;
const MILESTONE = 'm9-roof';
const LOG_ID = fixtures.campaign.logWorkCommodityId!;
const HIT_ID = fixtures.campaign.milestoneHitCommodityId!;
const LOG_HASH = '3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12';
const HIT_HASH = '9a1d4e7c-2b36-4f58-a0c9-7e5b3d1f6a24';
const DQ = '41dq0000000000000000000000000000000000000000000000000000000000000a';

/** The twin each item is sold from, and its API key. Neither may be stored, logged or answered. */
const LOG_TWIN = 'logitem0001.micro.biz.todaq.net';
const HIT_TWIN = 'hititem0001.micro.biz.todaq.net';
const LOG_KEY = 'log-twin-key-SECRET-1a2b';
const HIT_KEY = 'hit-twin-key-SECRET-3c4d';

/** The two end-to-end test people, as their Qatom sign-in registers them. */
const TEST_CONTRACTOR = 'e2e-contractor';
const TEST_CONFIRMER = 'e2e-confirmer';
const CONTRACTOR_AGENT = 'e2e-contractor-agent.micro.biz.todaq.net';
const CONTRACTOR_PRIMARY = 'e2e-contractor-primary.micro.biz.todaq.net';
const CONFIRMER_AGENT = 'e2e-confirmer-agent.micro.biz.todaq.net';
const CONFIRMER_PRIMARY = 'e2e-confirmer-primary.micro.biz.todaq.net';

/** A real party of the fixture campaign. Never refunded by the test-accounts pass. */
const supplier = fixtures.parties[1]!;
const templateParty = fixtures.parties[0]!;
const templateLog = fixtures.entries.find((entry) => entry.item === 'log_work')!;
const templateHit = fixtures.entries.find((entry) => entry.item === 'milestone_hit')!;

let test: TestDatabase;
let requests: { method: string; origin: string; path: string; body: unknown }[];
let logged: string;
/** What each item twin "holds", in decimal USD-TDN. */
let balances: Record<string, number>;
/** What a twin "answers" to its transfer in this test. */
let answerTwinTransfer: () => Response | Promise<Response>;
/** What Qatom "answers" to GET /v4/twins in this test. */
let answerTwins: () => Response;
/** The settled purchases Qatom "knows" in this test, by transaction id. */
let settledPurchases: Record<string, Record<string, unknown>>;

const twinOf = (hostname: string) => `https://${hostname}`;
const twinTransfers = () =>
	requests.filter(({ method, path }) => method === 'POST' && path === `/dq/${DQ}/transfer`);
const productTransfers = () => requests.filter(({ path }) => path === '/v4/transfer');
const twinCalls = () => requests.filter(({ origin }) => origin !== QATOM);

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	requests = [];
	logged = '';
	entryNumber = 0;
	balances = { [LOG_TWIN]: 50, [HIT_TWIN]: 50 };
	answerTwinTransfer = () => Response.json({ ok: true });
	settledPurchases = {};
	answerTwins = () =>
		Response.json({
			twins: [
				{ id: 1, key: 'main-key', hostname: 'tejido-main.biz.todaq.net', is_primary: true },
				{ id: 2, key: LOG_KEY, hostname: LOG_TWIN, twin_type: 'provider' },
				{ id: 3, key: HIT_KEY, hostname: HIT_TWIN, twin_type: 'provider' }
			]
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
			if (method === 'GET' && url.pathname === '/v4/catalog/items') {
				const commodityId = Number(url.searchParams.get('commodity_id'));
				const hash = commodityId === LOG_ID ? LOG_HASH : commodityId === HIT_ID ? HIT_HASH : null;
				const items =
					hash === null ? [] : [{ id: 42, commodity_id: commodityId, commodity_hash: hash }];
				return Response.json({ items });
			}
			const ledger = /^\/v4\/commodity\/([0-9a-f-]+)\/transactions$/.exec(url.pathname);
			if (method === 'GET' && ledger) {
				const hostname = ledger[1] === LOG_HASH ? LOG_TWIN : HIT_TWIN;
				return Response.json({
					commodity: { dq: DQ, hostname },
					calculation: { transactions: [] }
				});
			}
			if (method === 'GET' && url.pathname === '/v4/twins') return answerTwins();
			const sale = /^\/v4\/catalog\/purchases\/([0-9a-f-]+)$/.exec(url.pathname);
			if (method === 'GET' && sale) {
				const purchase = settledPurchases[sale[1]!];
				return purchase === undefined
					? Response.json({ error: 'Not found', status: 404 }, { status: 404 })
					: Response.json({ purchase: { transaction_id: sale[1], ...purchase } });
			}
			// The product's refund, to a primary wallet. Never used for a test person.
			if (method === 'POST' && url.pathname === '/v4/transfer') {
				return Response.json({}, { status: 202 });
			}
		}
		for (const [hostname, key] of [
			[LOG_TWIN, LOG_KEY],
			[HIT_TWIN, HIT_KEY]
		] as const) {
			if (url.origin !== twinOf(hostname) || url.searchParams.get('apiKey') !== key) continue;
			if (method === 'GET' && url.pathname === `/dq/${DQ}`) {
				return Response.json({ balance: balances[hostname] });
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

/** Adds a party to the fixture campaign. */
async function addParty(
	id: string,
	email: string,
	wallets: { agent: string | null; primary: string | null }
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
		agentWalletHostname:
			wallets.agent === null ? null : agentWalletHostnameSchema.parse(wallets.agent),
		primaryWalletHostname:
			wallets.primary === null ? null : primaryWalletHostnameSchema.parse(wallets.primary)
	});
}

let entryNumber = 0;

/** Adds an entry with its deposit, as the check-in endpoint and the reconciler would. */
async function addEntry(
	partyId: string,
	item: 'log_work' | 'milestone_hit',
	options: {
		status?: EntryStatus;
		milestoneId?: string;
		amount?: number;
		/** How long ago the entry was filed. About an hour when not said, each a second apart. */
		filedMinutesAgo?: number;
	} = {}
) {
	entryNumber += 1;
	const { status = 'verified', milestoneId = MILESTONE } = options;
	const id = `ent-e2e-${entryNumber}`;
	const template = item === 'log_work' ? templateLog : templateHit;
	const stamped = status !== 'filed';
	await test.db.insert(entries).values({
		...template,
		id,
		milestoneId,
		partyId,
		inputs: { ...template.inputs, milestone_id: milestoneId },
		status,
		statusReason: null,
		payingWallet: stamped ? 'some-agent.micro.biz.todaq.net' : null,
		twistId: stamped ? `41twist${String(entryNumber).padStart(4, '0')}` : null,
		filedAt: new Date(
			options.filedMinutesAgo === undefined
				? Date.now() - 60 * 60_000 + entryNumber * 1000
				: Date.now() - options.filedMinutesAgo * 60_000
		).toISOString(),
		stampedAt: stamped ? '2026-11-14T11:00:05.000Z' : null,
		updatedAt: '2026-11-14T11:00:05.000Z'
	});
	const depositId = `dep-e2e-${entryNumber}`;
	await test.db.insert(deposits).values({
		id: depositId,
		entryId: id,
		amount: options.amount ?? DEPOSIT_AMOUNT[item],
		refundedAt: null
	});
	return depositId;
}

async function addMilestone(id: string, state: 'confirmed_independent' | 'claimed') {
	await test.db.insert(milestones).values({
		campaignId: CAMPAIGN,
		id,
		position: 9 + entryNumber,
		title: 'Roof on',
		description: '',
		kind: 'construction',
		ownerPartyId: templateParty.id,
		confirmerPartyId: fixtures.parties[2]!.id,
		dueDate: '2026-12-18',
		state,
		confirmedAt: state === 'claimed' ? null : '2026-11-14T12:00:00.000Z'
	});
}

/** The two test people, signed in, on the fixture campaign. Nothing filed yet. */
async function testPeople() {
	await addParty(TEST_CONTRACTOR, 'tejido-contractor@e2e.m.todaq.net', {
		agent: CONTRACTOR_AGENT,
		primary: CONTRACTOR_PRIMARY
	});
	// Stored in capitals: the domain is compared without regard to letter case.
	await addParty(TEST_CONFIRMER, 'Tejido-Confirmer@E2E.M.TODAQ.NET', {
		agent: CONFIRMER_AGENT,
		primary: CONFIRMER_PRIMARY
	});
}

/**
 * What one run of the paid tests leaves behind, on a confirmed milestone: the test
 * contractor's work log (0.10) and claim (1.00), the test confirmer's confirmation (1.00).
 * And, on the same milestone, a work log by a real party (the supplier).
 */
async function confirmedRun() {
	await testPeople();
	await addMilestone(MILESTONE, 'confirmed_independent');
	return {
		contractorLog: await addEntry(TEST_CONTRACTOR, 'log_work'),
		contractorClaim: await addEntry(TEST_CONTRACTOR, 'milestone_hit'),
		confirmation: await addEntry(TEST_CONFIRMER, 'milestone_hit'),
		supplierLog: await addEntry(supplier.id, 'log_work')
	};
}

// --- Calling the endpoints ---------------------------------------------------------------

function event(path: string, body: unknown, headers: Record<string, string>) {
	const request = new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const account = createMerchantAccount({
		paymentApiUrl: QATOM,
		clientId: 'test-account-client',
		clientSecret: 'test-account-secret'
	});
	const locals = {
		ctx: { db: test.db, config: { CHECKIN_SHARED_SECRET: SECRET }, qatom: { account } },
		session: null
	};
	return { request, locals };
}

/** One pass of the test-accounts refunds, as the timer asks for it. */
async function pass(headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }) {
	const response = await POST(
		event('/api/test-account-refunds', undefined, headers) as unknown as Parameters<typeof POST>[0]
	);
	const text = await response.text();
	return { status: response.status, text, report: JSON.parse(text) as TestRefundReport };
}

/** The product's refund of the roof milestone, as a person asks for it. */
async function productRefund() {
	const response = await postProductRefunds(
		event(
			'/api/refunds',
			{ campaign_id: CAMPAIGN, milestone_id: MILESTONE },
			{ [CHECKIN_SECRET_HEADER]: SECRET }
		) as unknown as Parameters<typeof postProductRefunds>[0]
	);
	expect(response.status).toBe(200);
	return (await response.json()) as RefundReport;
}

async function refundedAt(depositId: string) {
	const all = await listDeposits(test.db, CAMPAIGN);
	return all.find((deposit) => deposit.id === depositId)!.refundedAt;
}

const roofRefunds = () => listRefunds(test.db, CAMPAIGN, MILESTONE);
const skippedReasons = (report: TestRefundReport) => report.skipped.map(({ reason }) => reason);

// -----------------------------------------------------------------------------------------

describe('who may ask', () => {
	it('refuses a caller without the shared secret, before anything else', async () => {
		await confirmedRun();
		expect((await pass({})).status).toBe(401);
		expect((await pass({ [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect(requests).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});
});

describe('a test person on a confirmed milestone', () => {
	it('gets each deposit back in their agent wallet, out of the twin of the item it paid for', async () => {
		const run = await confirmedRun();
		const { status, report } = await pass();

		expect(status).toBe(200);
		expect(report.sent).toHaveLength(3);
		expect(report.asked_total).toBe(2100);
		expect(report.needs_a_person).toBe(false);

		// One transfer per person and item, each for exactly that person's own deposits, in
		// decimal USD-TDN (our 100 goes out as 0.1, our 1000 as 1), to the AGENT wallet.
		const sent = twinTransfers().map(({ origin, body }) => ({ from: origin, body }));
		expect(sent).toHaveLength(3);
		expect(sent).toContainEqual({
			from: twinOf(LOG_TWIN),
			body: { amount: 0.1, destination: `https://${CONTRACTOR_AGENT}` }
		});
		expect(sent).toContainEqual({
			from: twinOf(HIT_TWIN),
			body: { amount: 1, destination: `https://${CONTRACTOR_AGENT}` }
		});
		expect(sent).toContainEqual({
			from: twinOf(HIT_TWIN),
			body: { amount: 1, destination: `https://${CONFIRMER_AGENT}` }
		});
		// Never a primary wallet, and never Qatom's own transfer.
		expect(JSON.stringify(sent)).not.toContain('-primary.');
		expect(productTransfers()).toEqual([]);

		for (const id of [run.contractorLog, run.contractorClaim, run.confirmation]) {
			expect(await refundedAt(id), id).not.toBeNull();
		}
	});

	it('records each refund as sent, to the agent wallet and no primary wallet', async () => {
		const run = await confirmedRun();
		const { report } = await pass();

		const rows = await roofRefunds();
		expect(rows).toHaveLength(3);
		for (const row of rows) {
			expect(row.status).toBe('sent');
			expect(row.primaryWalletHostname).toBeNull();
			expect(row.dq).toBe(DQ);
		}
		expect(rows.map((row) => [row.partyId, row.agentWalletHostname, row.amount]).sort()).toEqual(
			[
				[TEST_CONTRACTOR, CONTRACTOR_AGENT, 100],
				[TEST_CONTRACTOR, CONTRACTOR_AGENT, 1000],
				[TEST_CONFIRMER, CONFIRMER_AGENT, 1000]
			].sort()
		);
		expect(report.sent.map(({ deposit_ids }) => deposit_ids).sort()).toEqual(
			[[run.contractorLog], [run.contractorClaim], [run.confirmation]].sort()
		);
	});

	it('adds up one person’s deposits for one item into one transfer of exactly their sum', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		await addEntry(TEST_CONTRACTOR, 'log_work');
		await addEntry(TEST_CONTRACTOR, 'log_work');
		await addEntry(TEST_CONTRACTOR, 'log_work');
		await addEntry(TEST_CONFIRMER, 'log_work');
		await pass();

		expect(twinTransfers().map(({ body }) => body)).toEqual([
			{ amount: 0.3, destination: `https://${CONTRACTOR_AGENT}` },
			{ amount: 0.1, destination: `https://${CONFIRMER_AGENT}` }
		]);
		const rows = await roofRefunds();
		expect(rows.map((row) => row.amount).sort()).toEqual([100, 300]);
	});

	it('is refunded once: a second pass, and a third, send nothing', async () => {
		await confirmedRun();
		await pass();
		const again = await pass();
		await pass();

		expect(again.report.sent).toEqual([]);
		expect(again.report.skipped).toEqual([]);
		expect(twinTransfers()).toHaveLength(3);
		expect(await roofRefunds()).toHaveLength(3);
	});

	it('is refunded once when two passes run at the same moment', async () => {
		await confirmedRun();
		const [first, second] = await Promise.all([pass(), pass()]);

		expect(twinTransfers()).toHaveLength(3);
		expect(first.report.sent.length + second.report.sent.length).toBe(3);
		expect((await roofRefunds()).filter((row) => row.status === 'sent')).toHaveLength(3);
	});

	it('waits while the milestone is not confirmed and the deposit is still young', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		await addEntry(TEST_CONTRACTOR, 'milestone_hit', { filedMinutesAgo: 1 });
		const { report } = await pass();

		expect(report).toMatchObject({ sent: [], skipped: [] });
		expect(requests).toEqual([]);
	});

	it('waits until the reconciler has matched the payment, and never sends a flagged one', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		await addEntry(TEST_CONTRACTOR, 'log_work', { status: 'filed' });
		await addEntry(TEST_CONFIRMER, 'milestone_hit', { status: 'flagged' });
		const { report } = await pass();

		expect(report.sent).toEqual([]);
		expect(skippedReasons(report).sort()).toEqual(['entry_flagged', 'entry_not_verified']);
		expect(report.needs_a_person).toBe(true);
		expect(requests).toEqual([]);
	});

	it('is skipped, with the reason, when they have no agent wallet registered', async () => {
		await addParty('e2e-new', 'new@e2e.m.todaq.net', { agent: null, primary: CONTRACTOR_PRIMARY });
		await addMilestone(MILESTONE, 'confirmed_independent');
		const depositId = await addEntry('e2e-new', 'log_work');
		const { report } = await pass();

		expect(report.sent).toEqual([]);
		expect(report.skipped).toEqual([
			expect.objectContaining({
				party_id: 'e2e-new',
				reason: 'no_agent_wallet',
				deposit_ids: [depositId]
			})
		]);
		// The primary wallet is never used instead.
		expect(requests).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('is skipped when their agent wallet is not a wallet address Qatom accepts', async () => {
		await addParty('e2e-odd', 'odd@e2e.m.todaq.net', {
			agent: 'odd-agent.wallets.tejido.example',
			primary: null
		});
		await addMilestone(MILESTONE, 'confirmed_independent');
		await addEntry('e2e-odd', 'log_work');
		const { report } = await pass();

		expect(skippedReasons(report)).toEqual(['recipient_not_a_wallet']);
		expect(twinCalls()).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('is skipped when a deposit is not the fixed price of its item', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		await addEntry(TEST_CONTRACTOR, 'log_work', { amount: 100_000 });
		const { report } = await pass();

		expect(skippedReasons(report)).toEqual(['unexpected_deposit_amount']);
		expect(report.needs_a_person).toBe(true);
		expect(requests).toEqual([]);
	});
});

describe('a run that failed: the milestone is never confirmed', () => {
	it('the age is one constant, 20 minutes, counted from when the entry was filed', () => {
		expect(UNCONFIRMED_REFUND_AGE_MINUTES).toBe(20);
		const now = new Date('2026-11-15T12:00:00.000Z');
		const filed = (filedAt: string, milestoneConfirmed = false) => ({
			filedAt,
			milestoneConfirmed
		});

		expect(isDueForRefund(filed('2026-11-15T11:40:00.001Z'), now)).toBe(false);
		expect(isDueForRefund(filed('2026-11-15T11:40:00.000Z'), now)).toBe(true);
		expect(isDueForRefund(filed('2026-11-15T11:39:59.999Z'), now)).toBe(true);
		// Not filed yet by this clock, or a time that cannot be read: never old enough.
		expect(isDueForRefund(filed('2026-11-15T12:05:00.000Z'), now)).toBe(false);
		expect(isDueForRefund(filed('not a time'), now)).toBe(false);
		// A confirmed milestone's deposit is due at once, whatever its age.
		expect(isDueForRefund(filed('2026-11-15T11:59:59.000Z', true), now)).toBe(true);
		expect(isDueForRefund(filed('not a time', true), now)).toBe(true);
	});

	it('leaves a deposit alone at 19 minutes: not sent, not skipped, not logged', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		const log = await addEntry(TEST_CONTRACTOR, 'log_work', { filedMinutesAgo: 19 });
		const claim = await addEntry(TEST_CONTRACTOR, 'milestone_hit', { filedMinutesAgo: 19 });
		const { report } = await pass();

		expect(report).toMatchObject({ sent: [], skipped: [], asked_total: 0 });
		expect(requests).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
		expect(await refundedAt(log)).toBeNull();
		expect(await refundedAt(claim)).toBeNull();
		expect(logged).not.toContain('Test-account refunds');
	});

	it('refunds it at 20 minutes, to the agent wallet, out of the item’s twin', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		// What the first real failed run left: a work log and a claim, no confirmation.
		const log = await addEntry(TEST_CONTRACTOR, 'log_work', { filedMinutesAgo: 20 });
		const claim = await addEntry(TEST_CONTRACTOR, 'milestone_hit', { filedMinutesAgo: 20 });
		const { report } = await pass();

		expect(report.skipped).toEqual([]);
		expect(report.asked_total).toBe(1100);
		expect(twinTransfers().map(({ origin, body }) => ({ from: origin, body }))).toEqual([
			{ from: twinOf(LOG_TWIN), body: { amount: 0.1, destination: `https://${CONTRACTOR_AGENT}` } },
			{ from: twinOf(HIT_TWIN), body: { amount: 1, destination: `https://${CONTRACTOR_AGENT}` } }
		]);
		expect(productTransfers()).toEqual([]);
		expect(await refundedAt(log)).not.toBeNull();
		expect(await refundedAt(claim)).not.toBeNull();
		const rows = await roofRefunds();
		expect(
			rows.map((row) => [row.status, row.agentWalletHostname, row.primaryWalletHostname])
		).toEqual([
			['sent', CONTRACTOR_AGENT, null],
			['sent', CONTRACTOR_AGENT, null]
		]);
	});

	it('takes only the deposits that are old enough; the young ones wait their turn', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		const old = await addEntry(TEST_CONTRACTOR, 'log_work', { filedMinutesAgo: 25 });
		const young = await addEntry(TEST_CONTRACTOR, 'log_work', { filedMinutesAgo: 5 });
		const { report } = await pass();

		expect(report.sent.map(({ deposit_ids }) => deposit_ids)).toEqual([[old]]);
		expect(twinTransfers().map(({ body }) => body)).toEqual([
			{ amount: 0.1, destination: `https://${CONTRACTOR_AGENT}` }
		]);
		expect(await refundedAt(young)).toBeNull();
	});

	it('is not sent again when the milestone is confirmed later', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		await addEntry(TEST_CONTRACTOR, 'log_work', { filedMinutesAgo: 30 });
		await addEntry(TEST_CONTRACTOR, 'milestone_hit', { filedMinutesAgo: 30 });
		await pass();
		expect(twinTransfers()).toHaveLength(2);

		await test.db
			.update(milestones)
			.set({ state: 'confirmed_independent', confirmedAt: new Date().toISOString() })
			.where(eq(milestones.id, MILESTONE));
		// The confirmation itself is new, and is refunded once, at once.
		const confirmation = await addEntry(TEST_CONFIRMER, 'milestone_hit', { filedMinutesAgo: 0 });
		const after = await pass();
		await pass();

		expect(after.report.sent.map(({ deposit_ids }) => deposit_ids)).toEqual([[confirmation]]);
		expect(twinTransfers()).toHaveLength(3);
		expect((await roofRefunds()).map((row) => row.status)).toEqual(['sent', 'sent', 'sent']);
	});

	it('keeps every other rule: the payment must be matched, and never a flagged one', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		await addEntry(TEST_CONTRACTOR, 'log_work', { status: 'filed', filedMinutesAgo: 40 });
		await addEntry(TEST_CONTRACTOR, 'milestone_hit', { status: 'flagged', filedMinutesAgo: 40 });
		await addEntry(TEST_CONFIRMER, 'log_work', { amount: 100_000, filedMinutesAgo: 40 });
		const { report } = await pass();

		expect(report.sent).toEqual([]);
		expect(skippedReasons(report).sort()).toEqual([
			'entry_flagged',
			'entry_not_verified',
			'unexpected_deposit_amount'
		]);
		expect(requests).toEqual([]);
	});

	it('is tried once only: a refusal is not tried again', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		await addEntry(TEST_CONTRACTOR, 'milestone_hit', { filedMinutesAgo: 30 });
		answerTwinTransfer = () => Response.json({ error: 'no' }, { status: 500 });
		await pass();
		answerTwinTransfer = () => Response.json({ ok: true });
		const second = await pass();

		expect(skippedReasons(second.report)).toEqual(['refund_tried_before']);
		expect(twinTransfers()).toHaveLength(1);
	});

	it('never touches a real party’s deposit on an unconfirmed milestone, however old', async () => {
		await addMilestone(MILESTONE, 'claimed');
		const supplierLog = await addEntry(supplier.id, 'log_work', { filedMinutesAgo: 60 * 24 * 30 });
		const contractorClaim = await addEntry(templateParty.id, 'milestone_hit', {
			filedMinutesAgo: 600
		});
		await addParty('lookalike-z', 'someone@sub.e2e.m.todaq.net', {
			agent: CONTRACTOR_AGENT,
			primary: CONTRACTOR_PRIMARY
		});
		const lookalike = await addEntry('lookalike-z', 'log_work', { filedMinutesAgo: 600 });
		const { report } = await pass();

		// The fixtures' own real deposits on open and claimed milestones are older still.
		expect(report).toMatchObject({ sent: [], skipped: [], asked_total: 0 });
		expect(requests).toEqual([]);
		expect(await test.db.select().from(refunds)).toEqual([]);
		for (const id of [supplierLog, contractorClaim, lookalike, 'dep-m2-log-1', 'dep-m3-delivery']) {
			expect(await refundedAt(id), id).toBeNull();
		}
		expect(logged).not.toContain('Test-account refunds');
	});

	it('the log line still names only counts and reasons', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'claimed');
		await addEntry(TEST_CONTRACTOR, 'log_work', { filedMinutesAgo: 21 });
		await addEntry(TEST_CONTRACTOR, 'milestone_hit', { status: 'flagged', filedMinutesAgo: 21 });
		await addEntry(TEST_CONFIRMER, 'log_work', { filedMinutesAgo: 3 });
		await pass();

		const lines = logged.split('\n').filter((line) => line.startsWith('Test-account refunds:'));
		expect(lines).toEqual([
			'Test-account refunds: 1 sent, 1 skipped (entry_flagged 1), a person needs to look: YES.'
		]);
	});
});

describe('an entry verified by Qatom’s purchase record', () => {
	it('is picked up by the refund pass like any other verified entry', async () => {
		const TRANSACTION = '3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12';
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		// Filed, with the purchase Qatom named, and not yet looked at by the reconciler.
		const depositId = await addEntry(TEST_CONTRACTOR, 'log_work', {
			status: 'filed',
			filedMinutesAgo: 3
		});
		const entryId = depositId.replace('dep-', 'ent-');
		await test.db
			.insert(entryPurchases)
			.values({ entryId, transactionId: TRANSACTION, catalogItemId: 42 });

		// Before the reconciler has run, the refund pass leaves it alone.
		const before = await pass();
		expect(skippedReasons(before.report)).toEqual(['entry_not_verified']);
		expect(twinTransfers()).toEqual([]);

		settledPurchases[TRANSACTION] = {
			catalog_item_id: 42,
			amount: '0.100',
			settled_at: new Date().toISOString()
		};
		const account = createMerchantAccount({
			paymentApiUrl: QATOM,
			clientId: 'test-account-client',
			clientSecret: 'test-account-secret'
		});
		expect(await reconcile(test.db, account)).toMatchObject({ verified: 1 });

		const after = await pass();
		expect(after.report.sent.map(({ deposit_ids }) => deposit_ids)).toEqual([[depositId]]);
		expect(twinTransfers().map(({ body }) => body)).toEqual([
			{ amount: 0.1, destination: `https://${CONTRACTOR_AGENT}` }
		]);
		expect(await refundedAt(depositId)).not.toBeNull();
	});
});

describe('which item’s twin pays', () => {
	it('a campaign with no item ids of its own is refunded under the two shared items', async () => {
		// What the campaign builder makes, and so what the paid tests file on.
		await test.db
			.update(campaigns)
			.set({ logWorkCommodityId: null, milestoneHitCommodityId: null })
			.where(eq(campaigns.id, CAMPAIGN));
		const run = await confirmedRun();
		const { report } = await pass();

		// The stand-in for Qatom knows only the shared ids, so these went out under them.
		expect(SHARED_ITEM_COMMODITY_ID).toEqual({ log_work: LOG_ID, milestone_hit: HIT_ID });
		expect(report.skipped).toEqual([]);
		expect(report.sent).toHaveLength(3);
		expect(twinTransfers().map(({ origin, body }) => ({ from: origin, body }))).toEqual([
			{ from: twinOf(LOG_TWIN), body: { amount: 0.1, destination: `https://${CONTRACTOR_AGENT}` } },
			{ from: twinOf(HIT_TWIN), body: { amount: 1, destination: `https://${CONTRACTOR_AGENT}` } },
			{ from: twinOf(HIT_TWIN), body: { amount: 1, destination: `https://${CONFIRMER_AGENT}` } }
		]);
		for (const id of [run.contractorLog, run.contractorClaim, run.confirmation]) {
			expect(await refundedAt(id), id).not.toBeNull();
		}
	});

	it('a campaign that stores an id of its own is read under that id, not the shared one', async () => {
		// An id the stand-in for Qatom does not know: if the shared item were used instead,
		// the work log would be refunded.
		await test.db
			.update(campaigns)
			.set({ logWorkCommodityId: 9999 })
			.where(eq(campaigns.id, CAMPAIGN));
		await confirmedRun();
		const { report } = await pass();

		expect(report.sent.map(({ item }) => item)).toEqual(['milestone_hit', 'milestone_hit']);
		expect(report.skipped).toEqual([
			expect.objectContaining({ item: 'log_work', reason: 'qatom_unavailable' })
		]);
		expect(twinTransfers().every(({ origin }) => origin === twinOf(HIT_TWIN))).toBe(true);
	});
});

describe('nobody else', () => {
	it('never touches a real party: no request at all when no test person has deposits', async () => {
		await addMilestone(MILESTONE, 'confirmed_independent');
		const supplierLog = await addEntry(supplier.id, 'log_work');
		const contractorClaim = await addEntry(templateParty.id, 'milestone_hit');
		const { report } = await pass();

		expect(report).toMatchObject({ sent: [], skipped: [], asked_total: 0 });
		expect(requests).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
		expect(await refundedAt(supplierLog)).toBeNull();
		expect(await refundedAt(contractorClaim)).toBeNull();
	});

	it('never touches a party at a domain that only looks like the test inbox', async () => {
		await addMilestone(MILESTONE, 'confirmed_independent');
		const lookalikes = [
			'someone@sub.e2e.m.todaq.net',
			'someone@e2e.m.todaq.net.example',
			'someone@note2e.m.todaq.net',
			'someone@m.todaq.net',
			'e2e.m.todaq.net@example.org'
		];
		for (const [index, email] of lookalikes.entries()) {
			const id = `lookalike-${'abcde'[index]}`;
			await addParty(id, email, { agent: CONTRACTOR_AGENT, primary: CONTRACTOR_PRIMARY });
			await addEntry(id, 'log_work');
		}
		const { report } = await pass();

		expect(report).toMatchObject({ sent: [], skipped: [] });
		expect(requests).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('leaves a real party on the same milestone alone, even with a Qatom-style agent wallet', async () => {
		const run = await confirmedRun();
		await test.db
			.update(parties)
			.set({
				agentWalletHostname: agentWalletHostnameSchema.parse('supplier-agent.micro.biz.todaq.net')
			})
			.where(eq(parties.id, supplier.id));
		const { text } = await pass();

		expect(text).not.toContain(supplier.id);
		expect(JSON.stringify(twinTransfers())).not.toContain('supplier');
		expect(await refundedAt(run.supplierLog)).toBeNull();
		expect((await roofRefunds()).some((row) => row.partyId === supplier.id)).toBe(false);
	});

	it('a real party is refunded only by POST /api/refunds, and only to the primary wallet', async () => {
		const run = await confirmedRun();
		await pass();
		const report = await productRefund();

		// The supplier's 0.10, through Qatom's own transfer, to the supplier's PRIMARY wallet.
		expect(productTransfers().map(({ body }) => body)).toEqual([
			expect.objectContaining({
				address: `https://${supplier.primaryWalletHostname}`,
				type: DQ,
				amount: 0.1
			})
		]);
		expect(report.sent).toEqual([
			expect.objectContaining({ party_id: supplier.id, deposit_ids: [run.supplierLog] })
		]);
		expect(await refundedAt(run.supplierLog)).not.toBeNull();

		const supplierRows = (await roofRefunds()).filter((row) => row.partyId === supplier.id);
		expect(supplierRows).toHaveLength(1);
		expect(supplierRows[0]).toMatchObject({
			status: 'sent',
			primaryWalletHostname: supplier.primaryWalletHostname,
			agentWalletHostname: null
		});
		// No twin ever sent anything to the supplier.
		expect(JSON.stringify(twinTransfers())).not.toContain('island-schoolbooks');
	});

	it('POST /api/refunds never refunds a test person, to either wallet', async () => {
		const run = await confirmedRun();
		// Asked BEFORE any test-accounts pass, so the test people's deposits are still there.
		const report = await productRefund();

		expect(report.sent.map(({ party_id }) => party_id)).toEqual([supplier.id]);
		expect(report.skipped.map(({ party_id, reason }) => [party_id, reason]).sort()).toEqual(
			[
				[TEST_CONTRACTOR, 'test_person'],
				[TEST_CONFIRMER, 'test_person']
			].sort()
		);
		expect(productTransfers()).toHaveLength(1);
		expect(JSON.stringify(productTransfers())).not.toContain('e2e-');
		expect(twinCalls()).toEqual([]);
		for (const id of [run.contractorLog, run.contractorClaim, run.confirmation]) {
			expect(await refundedAt(id), id).toBeNull();
		}
		// And the pass still refunds them afterwards, once.
		await pass();
		expect(twinTransfers()).toHaveLength(3);
	});

	it('the table refuses a refund that names both wallets, or neither', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		const row = {
			id: 'rfd-bad',
			campaignId: CAMPAIGN,
			milestoneId: MILESTONE,
			partyId: TEST_CONTRACTOR,
			dq: DQ,
			amount: 100,
			status: 'started' as const,
			statusReason: null,
			startedAt: '2026-11-15T09:00:00.000Z',
			settledAt: null
		};
		await expect(test.db.insert(refunds).values(row)).rejects.toThrow();
		await expect(
			test.db.insert(refunds).values({
				...row,
				agentWalletHostname: agentWalletHostnameSchema.parse(CONTRACTOR_AGENT),
				primaryWalletHostname: primaryWalletHostnameSchema.parse(CONTRACTOR_PRIMARY)
			})
		).rejects.toThrow();
		expect(await roofRefunds()).toEqual([]);
	});
});

describe('when the transfer does not go through', () => {
	it('a twin that refuses: recorded as failed, and never tried again by the timer', async () => {
		const run = await confirmedRun();
		answerTwinTransfer = () => Response.json({ error: 'no' }, { status: 500 });
		const first = await pass();

		expect(first.report.sent).toEqual([]);
		expect(skippedReasons(first.report)).toEqual([
			'transfer_refused',
			'transfer_refused',
			'transfer_refused'
		]);
		expect(first.report.needs_a_person).toBe(true);
		const rows = await roofRefunds();
		expect(rows.map((row) => row.status)).toEqual(['failed', 'failed', 'failed']);
		expect(rows[0]!.statusReason).toContain('500');
		expect(await refundedAt(run.contractorLog)).toBeNull();

		// The twin is well again. The timer still does not send these a second time.
		answerTwinTransfer = () => Response.json({ ok: true });
		const second = await pass();
		expect(second.report.sent).toEqual([]);
		expect(new Set(skippedReasons(second.report))).toEqual(new Set(['refund_tried_before']));
		expect(twinTransfers()).toHaveLength(3);
		expect(await test.db.select().from(refundAttempts)).toHaveLength(3);
	});

	it('no answer: recorded as unknown, keeps its deposits, and is never sent again', async () => {
		const run = await confirmedRun();
		answerTwinTransfer = () => {
			throw new TypeError('socket hang up');
		};
		const first = await pass();

		expect(skippedReasons(first.report)).toEqual([
			'transfer_outcome_unknown',
			'transfer_outcome_unknown',
			'transfer_outcome_unknown'
		]);
		expect((await roofRefunds()).map((row) => row.status)).toEqual([
			'unknown',
			'unknown',
			'unknown'
		]);
		expect(await test.db.select().from(refundDeposits)).toHaveLength(3);
		expect(await refundedAt(run.confirmation)).toBeNull();

		answerTwinTransfer = () => Response.json({ ok: true });
		const second = await pass();
		expect(second.report.sent).toEqual([]);
		expect(new Set(skippedReasons(second.report))).toEqual(new Set(['refund_outcome_unknown']));
		expect(second.report.needs_a_person).toBe(true);
		expect(twinTransfers()).toHaveLength(3);
	});

	it('a twin that cannot cover the amount: nothing sent or recorded, and tried on a later pass', async () => {
		await confirmedRun();
		balances[HIT_TWIN] = 0.999;
		const first = await pass();

		// The work log's twin could pay; the claim's and the confirmation's could not.
		expect(first.report.sent).toHaveLength(1);
		expect(skippedReasons(first.report)).toEqual([
			'item_twin_balance_too_low',
			'item_twin_balance_too_low'
		]);
		expect(twinTransfers()).toHaveLength(1);
		expect(await roofRefunds()).toHaveLength(1);

		balances[HIT_TWIN] = 2;
		const second = await pass();
		expect(second.report.sent).toHaveLength(2);
		expect(twinTransfers()).toHaveLength(3);
	});

	it('Qatom withholding the key, or out of reach: nothing sent or recorded', async () => {
		await confirmedRun();
		answerTwins = () =>
			Response.json({
				twins: [
					{ id: 2, key: null, hostname: LOG_TWIN },
					{ id: 3, key: '', hostname: HIT_TWIN }
				]
			});
		const withheld = await pass();
		expect(new Set(skippedReasons(withheld.report))).toEqual(new Set(['item_twin_key_withheld']));

		answerTwins = () => Response.json({ error: 'down' }, { status: 503 });
		const down = await pass();
		expect(new Set(skippedReasons(down.report))).toEqual(new Set(['qatom_unavailable']));

		expect(twinCalls()).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});
});

describe('the limit on one pass', () => {
	it('is 10.00', () => {
		expect(PASS_LIMIT).toBe(10_000);
	});

	it('stops a pass from asking for more than the limit; the rest waits for the next pass', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		for (let n = 0; n < 6; n += 1) await addEntry(TEST_CONTRACTOR, 'milestone_hit');
		for (let n = 0; n < 6; n += 1) await addEntry(TEST_CONFIRMER, 'milestone_hit');
		const first = await pass();

		expect(first.report.asked_total).toBe(6000);
		expect(first.report.sent).toHaveLength(1);
		expect(skippedReasons(first.report)).toEqual(['pass_limit_reached']);
		expect(twinTransfers().map(({ body }) => body)).toEqual([
			{ amount: 6, destination: `https://${CONTRACTOR_AGENT}` }
		]);

		const second = await pass();
		expect(second.report.sent).toHaveLength(1);
		expect(twinTransfers()).toHaveLength(2);
	});

	it('counts what was asked for even when the outcome is unknown', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		for (let n = 0; n < 6; n += 1) await addEntry(TEST_CONTRACTOR, 'milestone_hit');
		for (let n = 0; n < 6; n += 1) await addEntry(TEST_CONFIRMER, 'milestone_hit');
		answerTwinTransfer = () => {
			throw new TypeError('socket hang up');
		};
		const { report } = await pass();

		expect(report.asked_total).toBe(6000);
		expect(skippedReasons(report).sort()).toEqual([
			'pass_limit_reached',
			'transfer_outcome_unknown'
		]);
		expect(twinTransfers()).toHaveLength(1);
	});

	it('never sends one transfer that is by itself over the limit', async () => {
		await testPeople();
		await addMilestone(MILESTONE, 'confirmed_independent');
		for (let n = 0; n < 11; n += 1) await addEntry(TEST_CONTRACTOR, 'milestone_hit');
		const { report } = await pass();

		expect(skippedReasons(report)).toEqual(['transfer_over_limit']);
		expect(report.needs_a_person).toBe(true);
		expect(requests).toEqual([]);
	});
});

describe('the twin’s hostname and key are kept nowhere', () => {
	const SECRETS = [LOG_KEY, HIT_KEY, LOG_TWIN, HIT_TWIN, 'apiKey'];

	async function everythingStored(): Promise<string> {
		return JSON.stringify([
			await test.db.select().from(refunds),
			await test.db.select().from(refundDeposits),
			await test.db.select().from(refundAttempts)
		]);
	}

	it('not in the answer, the database or the logs when refunds are sent', async () => {
		await confirmedRun();
		const { text } = await pass();

		const out = `${text}\n${await everythingStored()}\n${logged}`;
		for (const secret of SECRETS) expect(out, secret).not.toContain(secret);
	});

	it('not when a twin refuses with an answer that echoes its own address', async () => {
		await confirmedRun();
		answerTwinTransfer = () =>
			Response.json(
				{ error: `POST https://${HIT_TWIN}/dq/${DQ}/transfer?apiKey=${HIT_KEY} refused` },
				{ status: 403 }
			);
		const { text } = await pass();

		expect(logged).toContain('Test refund refused by the twin');
		const out = `${text}\n${await everythingStored()}\n${logged}`;
		for (const secret of SECRETS) expect(out, secret).not.toContain(secret);
	});

	it('not when the connection fails with the address in its message', async () => {
		await confirmedRun();
		answerTwinTransfer = () => {
			throw new TypeError(
				`fetch failed: https://${HIT_TWIN}/dq/${DQ}/transfer?apiKey=${HIT_KEY} / ${LOG_KEY}`
			);
		};
		const { text } = await pass();

		expect(logged).toContain('Test refund outcome unknown');
		const out = `${text}\n${await everythingStored()}\n${logged}`;
		for (const secret of SECRETS) expect(out, secret).not.toContain(secret);
	});
});

describe('the line each pass writes to the logs', () => {
	const lines = () => logged.split('\n').filter((line) => line.startsWith('Test-account refunds:'));
	// Nothing that names a person, a wallet, a twin or a record may be in the line.
	const NEVER = [
		'biz.todaq.net',
		'todaq',
		'@',
		'https',
		'apiKey',
		LOG_KEY,
		HIT_KEY,
		'e2e-',
		'dep-',
		'rfd_',
		CAMPAIGN,
		MILESTONE
	];

	it('says how many were sent and that nobody needs to look', async () => {
		await confirmedRun();
		await pass();

		expect(lines()).toEqual([
			'Test-account refunds: 3 sent, 0 skipped, a person needs to look: no.'
		]);
		for (const text of NEVER) expect(lines().join(), text).not.toContain(text);
	});

	it('is not written when there was nothing to consider', async () => {
		await pass();
		await confirmedRun();
		await pass();
		await pass();

		// One line for the pass that sent; none before it, and none for the empty pass after.
		expect(lines()).toHaveLength(1);
	});

	it('makes a pass that skipped everything visible, with the reasons and their counts', async () => {
		await confirmedRun();
		balances[HIT_TWIN] = 0;
		balances[LOG_TWIN] = 0;
		await pass();

		expect(lines()).toEqual([
			'Test-account refunds: 0 sent, 3 skipped (item_twin_balance_too_low 3), a person needs to look: no.'
		]);
	});

	it('says when a person needs to look, and still names nobody', async () => {
		await confirmedRun();
		await addEntry(TEST_CONFIRMER, 'log_work', { status: 'flagged' });
		answerTwinTransfer = () =>
			Response.json(
				{ error: `https://${HIT_TWIN}/dq/${DQ}/transfer?apiKey=${HIT_KEY}` },
				{ status: 403 }
			);
		await pass();

		expect(lines()).toEqual([
			'Test-account refunds: 0 sent, 4 skipped (entry_flagged 1, transfer_refused 3), a person needs to look: YES.'
		]);
		for (const text of NEVER) expect(lines().join(), text).not.toContain(text);
	});
});
