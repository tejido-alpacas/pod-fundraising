// Calls the endpoint's own handler against a real, migrated, seeded local D1 database.
//
// NOTHING HERE REACHES QATOM OR MOVES MONEY. `fetch` is replaced for every test, and a request
// to anything the test did not expect fails the test. The merchant account is the real client
// from @tejido/qatom, pointed at an address that does not exist.
import { CHECKIN_SECRET_HEADER, DEPOSIT_AMOUNT, type EntryStatus } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaigns,
	deposits,
	entries,
	listDeposits,
	listDepositStatuses,
	listRefunds,
	milestones,
	parties,
	refundDeposits,
	refunds
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefundReport } from '#lib/server/backend/refunds.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const QATOM = 'https://qatom.invalid';
const CAMPAIGN = fixtures.campaign.id;
const MILESTONE = 'm9-roof';
/** The commodity ids the seeded campaign carries, and the hash Qatom's catalog gives for each. */
const LOG_ID = fixtures.campaign.logWorkCommodityId!;
const HIT_ID = fixtures.campaign.milestoneHitCommodityId!;
const LOG_HASH = 'logworkcommodityhash01';
const HIT_HASH = 'milestonehitcommodityhash02';
const DQ = '41dq0000000000000000000000000000000000000000000000000000000000000a';

const contractor = fixtures.parties[0]!;
const headTeacher = fixtures.parties[2]!;
const templateLog = fixtures.entries.find((entry) => entry.item === 'log_work')!;
const templateHit = fixtures.entries.find((entry) => entry.item === 'milestone_hit')!;

let test: TestDatabase;

/** Every request the code under test tried to make, in order. */
let requests: { method: string; path: string; body: unknown }[];
/** What Qatom "answers" to POST /v4/transfer in this test. */
let answerTransfer: () => Response | Promise<Response>;
/** What Qatom "answers" to a ledger read in this test. */
let answerLedger: (hash: string) => Response;
/** What Qatom "answers" when asked for the catalog item of a commodity id in this test. */
let answerListing: (commodityId: number) => Response;

/** A catalog listing as Qatom gives it: the commodity's one item, or none if it is unknown. */
const listing = (commodityId: number, hash: string | null) => {
	const items =
		hash === null
			? []
			: [{ id: 42, commodity_id: commodityId, commodity_hash: hash, active: true }];
	return Response.json({ items, total: items.length, limit: null, offset: 0 });
};
const ledgerReads = () => requests.filter((request) => request.path.startsWith('/v4/commodity/'));
const listingReads = () => requests.filter((request) => request.path === '/v4/catalog/items');

const accepted = () => Response.json({}, { status: 202 });
const transfers = () => requests.filter((request) => request.path === '/v4/transfer');

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	requests = [];
	entryNumber = 0;
	answerTransfer = accepted;
	answerLedger = () => Response.json({ commodity: { dq: DQ }, calculation: { transactions: [] } });
	answerListing = (commodityId) =>
		listing(
			commodityId,
			commodityId === LOG_ID ? LOG_HASH : commodityId === HIT_ID ? HIT_HASH : null
		);

	vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input);
		if (url.origin !== QATOM) throw new Error(`A test tried to reach ${url.origin}.`);
		const method = init?.method ?? 'GET';
		const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
		requests.push({ method, path: url.pathname, body });

		if (method === 'POST' && url.pathname === '/v4/account/oauth/token') {
			return Response.json({ access_token: 'test-account-token', expires_at: 4102444800 });
		}
		const ledger = /^\/v4\/commodity\/([0-9a-zA-Z]+)\/transactions$/.exec(url.pathname);
		if (method === 'GET' && ledger) return answerLedger(ledger[1]!);
		if (
			method === 'GET' &&
			url.pathname === '/v4/catalog/items' &&
			url.searchParams.get('mine') === 'true' &&
			url.searchParams.get('active') === 'all'
		) {
			return answerListing(Number(url.searchParams.get('commodity_id')));
		}
		if (method === 'POST' && url.pathname === '/v4/transfer') return answerTransfer();
		throw new Error(`A test made a request it did not expect: ${method} ${url.pathname}`);
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await test.destroy();
});

// --- Setting the scene -------------------------------------------------------------------

/** Stores the two items' commodity ids on the fixture campaign. The seed already has both. */
async function setCommodityIds() {
	await test.db
		.update(campaigns)
		.set({ logWorkCommodityId: LOG_ID, milestoneHitCommodityId: HIT_ID })
		.where(eq(campaigns.id, CAMPAIGN));
}

let entryNumber = 0;

/** Adds an entry on the roof milestone with its deposit, as the check-in endpoint would. */
async function addEntry(
	partyId: string,
	item: 'log_work' | 'milestone_hit',
	status: EntryStatus = 'verified'
) {
	entryNumber += 1;
	const id = `ent-roof-${entryNumber}`;
	const template = item === 'log_work' ? templateLog : templateHit;
	const stamped = status !== 'filed';
	await test.db.insert(entries).values({
		...template,
		id,
		milestoneId: MILESTONE,
		partyId,
		inputs: { ...template.inputs, milestone_id: MILESTONE },
		status,
		statusReason: null,
		payingWallet: stamped ? 'some-agent.wallets.tejido.example' : null,
		twistId: stamped ? `41twist${String(entryNumber).padStart(4, '0')}` : null,
		filedAt: `2026-11-1${entryNumber % 10}T10:00:00.000Z`,
		stampedAt: stamped ? '2026-11-12T10:00:05.000Z' : null,
		updatedAt: '2026-11-12T10:00:05.000Z'
	});
	const depositId = `dep-roof-${entryNumber}`;
	await test.db
		.insert(deposits)
		.values({ id: depositId, entryId: id, amount: DEPOSIT_AMOUNT[item], refundedAt: null });
	return depositId;
}

/**
 * A confirmed milestone with deposits by two parties: the contractor's two work logs and
 * claim (0.10 + 0.10 + 1.00) and the head teacher's confirmation (1.00). All verified.
 */
async function confirmedRoof() {
	await setCommodityIds();
	await test.db.insert(milestones).values({
		campaignId: CAMPAIGN,
		id: MILESTONE,
		position: 9,
		title: 'Roof on',
		description: '',
		kind: 'construction',
		ownerPartyId: contractor.id,
		confirmerPartyId: headTeacher.id,
		dueDate: '2026-12-18',
		state: 'confirmed_independent',
		confirmedAt: '2026-11-13T09:00:00.000Z'
	});
	return {
		contractorDeposits: [
			await addEntry(contractor.id, 'log_work'),
			await addEntry(contractor.id, 'log_work'),
			await addEntry(contractor.id, 'milestone_hit')
		],
		headTeacherDeposits: [await addEntry(headTeacher.id, 'milestone_hit')]
	};
}

const CONTRACTOR_TOTAL = 2 * DEPOSIT_AMOUNT.log_work + DEPOSIT_AMOUNT.milestone_hit;
const HEAD_TEACHER_TOTAL = DEPOSIT_AMOUNT.milestone_hit;

// --- Calling the endpoint ----------------------------------------------------------------

async function post(
	body: unknown = { campaign_id: CAMPAIGN, milestone_id: MILESTONE },
	headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }
) {
	const request = new Request('http://localhost/api/refunds', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
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
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	return { status: response.status, body: (await response.json()) as unknown };
}

/** Posts a refund that must be carried out (even if nothing ends up sent). */
async function refund() {
	const answer = await post();
	expect(answer.status).toBe(200);
	return answer.body as RefundReport & { refunded: boolean };
}

async function refundedAt(depositId: string) {
	const all = await listDeposits(test.db, CAMPAIGN);
	return all.find((deposit) => deposit.id === depositId)!.refundedAt;
}

const roofRefunds = () => listRefunds(test.db, CAMPAIGN, MILESTONE);

// -----------------------------------------------------------------------------------------

describe('who may ask, and for what', () => {
	it('refuses a caller without the shared secret, before anything else', async () => {
		await confirmedRoof();
		expect((await post(undefined, {})).status).toBe(401);
		expect((await post(undefined, { [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect(requests).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('refuses a body that does not name one milestone', async () => {
		expect((await post('not json')).status).toBe(400);
		expect((await post({ campaign_id: CAMPAIGN })).status).toBe(422);
		expect((await post({ campaign_id: CAMPAIGN, milestone_id: 7 })).status).toBe(422);
		expect(requests).toEqual([]);
	});

	it('refuses a milestone that does not exist', async () => {
		const answer = await post({ campaign_id: CAMPAIGN, milestone_id: 'nope' });
		expect(answer.status).toBe(404);
		expect(answer.body).toMatchObject({ refunded: false, error: 'unknown_milestone' });
		expect((await post({ campaign_id: 'nope', milestone_id: 'm1-foundation' })).status).toBe(404);
		expect(requests).toEqual([]);
	});

	it('refuses a milestone that is not confirmed, and sends nothing', async () => {
		await setCommodityIds();
		// The fixtures have m2-walls open and m3-books-delivered claimed, both with deposits.
		for (const milestoneId of ['m2-walls', 'm3-books-delivered']) {
			const answer = await post({ campaign_id: CAMPAIGN, milestone_id: milestoneId });
			expect(answer.status).toBe(409);
			expect(answer.body).toMatchObject({ refunded: false, error: 'milestone_not_confirmed' });
			expect(await listRefunds(test.db, CAMPAIGN, milestoneId)).toEqual([]);
		}
		expect(requests).toEqual([]);
		expect(await refundedAt('dep-m2-log-1')).toBeNull();
		expect(await refundedAt('dep-m3-delivery')).toBeNull();
	});
});

describe('a confirmed milestone', () => {
	it('sends each party their own total, to their primary wallet', async () => {
		const { contractorDeposits, headTeacherDeposits } = await confirmedRoof();

		const report = await refund();

		expect(report.refunded).toBe(true);
		expect(report.skipped).toEqual([]);
		expect(report.needs_a_person).toBe(false);
		expect(report.sent).toHaveLength(2);
		expect(report.sent).toContainEqual(
			expect.objectContaining({
				party_id: contractor.id,
				amount: CONTRACTOR_TOTAL,
				amount_display: '1.20',
				deposit_ids: contractorDeposits
			})
		);
		expect(report.sent).toContainEqual(
			expect.objectContaining({
				party_id: headTeacher.id,
				amount: HEAD_TEACHER_TOTAL,
				amount_display: '1.00',
				deposit_ids: headTeacherDeposits
			})
		);

		// Exactly two transfers: a twin URL for the PRIMARY wallet, the ledger's dq, the total.
		const sentBodies = transfers().map((request) => request.body);
		expect(sentBodies).toHaveLength(2);
		expect(sentBodies).toContainEqual(
			expect.objectContaining({
				address: `https://${contractor.primaryWalletHostname}`,
				type: DQ,
				amount: CONTRACTOR_TOTAL
			})
		);
		expect(sentBodies).toContainEqual(
			expect.objectContaining({
				address: `https://${headTeacher.primaryWalletHostname}`,
				type: DQ,
				amount: HEAD_TEACHER_TOTAL
			})
		);
		// Never an agent wallet.
		expect(JSON.stringify(sentBodies)).not.toContain('-agent.');

		// The books: every deposit is marked, and each refund is recorded as sent.
		for (const id of [...contractorDeposits, ...headTeacherDeposits]) {
			expect(await refundedAt(id)).not.toBeNull();
		}
		const recorded = await roofRefunds();
		expect(recorded.map((row) => row.status)).toEqual(['sent', 'sent']);
		expect(recorded.map((row) => row.amount).sort()).toEqual(
			[CONTRACTOR_TOTAL, HEAD_TEACHER_TOTAL].sort()
		);
	});

	it('sends nothing the second time', async () => {
		await confirmedRoof();
		await refund();
		expect(transfers()).toHaveLength(2);

		const again = await refund();

		expect(again.refunded).toBe(false);
		expect(again.sent).toEqual([]);
		expect(again.skipped).toEqual([]);
		expect(transfers()).toHaveLength(2);
		expect(await roofRefunds()).toHaveLength(2);
	});

	it('sends each deposit once when two requests arrive at the same moment', async () => {
		await confirmedRoof();
		// Hold every transfer open until both requests have had time to claim.
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		answerTransfer = async () => {
			await held;
			return accepted();
		};

		const both = Promise.all([refund(), refund()]);
		await vi.waitFor(() => expect(transfers().length).toBeGreaterThan(0));
		release();
		const [first, second] = await both;

		// Between them: one transfer per party, and no more.
		expect(transfers()).toHaveLength(2);
		const sent = [...first.sent, ...second.sent];
		expect(sent.map((line) => line.party_id).sort()).toEqual(
			[contractor.id, headTeacher.id].sort()
		);
		expect((await roofRefunds()).filter((row) => row.status === 'sent')).toHaveLength(2);
		expect(await test.db.select().from(refundDeposits)).toHaveLength(4);
	});

	it('skips a party with no primary wallet, and never uses their agent wallet', async () => {
		const { headTeacherDeposits } = await confirmedRoof();
		await test.db
			.update(parties)
			.set({ primaryWalletHostname: null })
			.where(eq(parties.id, headTeacher.id));

		const report = await refund();

		expect(report.sent.map((line) => line.party_id)).toEqual([contractor.id]);
		expect(report.skipped).toEqual([
			expect.objectContaining({
				party_id: headTeacher.id,
				reason: 'no_primary_wallet',
				amount: HEAD_TEACHER_TOTAL,
				deposit_ids: headTeacherDeposits,
				refund_id: null
			})
		]);
		expect(transfers()).toHaveLength(1);
		expect(JSON.stringify(transfers())).not.toContain(headTeacher.agentWalletHostname!);
		expect(await refundedAt(headTeacherDeposits[0]!)).toBeNull();
		// Nothing was started for them, so it goes through once they have signed in.
		expect(await roofRefunds()).toHaveLength(1);
	});

	it('leaves out entries the reconciler has not verified, or has flagged', async () => {
		await confirmedRoof();
		const notStamped = await addEntry(contractor.id, 'log_work', 'filed');
		const flagged = await addEntry(contractor.id, 'log_work', 'flagged');

		const report = await refund();

		expect(report.sent).toContainEqual(
			expect.objectContaining({ party_id: contractor.id, amount: CONTRACTOR_TOTAL })
		);
		expect(report.skipped).toContainEqual(
			expect.objectContaining({ reason: 'entry_not_verified', deposit_ids: [notStamped] })
		);
		expect(report.skipped).toContainEqual(
			expect.objectContaining({ reason: 'entry_flagged', deposit_ids: [flagged] })
		);
		expect(report.needs_a_person).toBe(true);
		expect(await refundedAt(notStamped)).toBeNull();
		expect(await refundedAt(flagged)).toBeNull();

		// Once the reconciler verifies the late entry, the next request sends just that one.
		await test.db
			.update(entries)
			.set({ status: 'verified', twistId: '41twistlate' })
			.where(eq(entries.id, 'ent-roof-5'));
		const later = await refund();
		expect(later.sent).toEqual([
			expect.objectContaining({ amount: DEPOSIT_AMOUNT.log_work, deposit_ids: [notStamped] })
		]);
		expect(transfers()).toHaveLength(3);
	});

	it('refunds an entry that is verified as paid but still missing evidence', async () => {
		await confirmedRoof();
		const incomplete = await addEntry(headTeacher.id, 'log_work', 'incomplete');

		const report = await refund();

		expect(report.sent).toContainEqual(
			expect.objectContaining({
				party_id: headTeacher.id,
				amount: HEAD_TEACHER_TOTAL + DEPOSIT_AMOUNT.log_work
			})
		);
		expect(await refundedAt(incomplete)).not.toBeNull();
	});
});

describe('when the transfer does not go through', () => {
	it('releases the deposits when Qatom refuses, so a later request can send them', async () => {
		const { contractorDeposits } = await confirmedRoof();
		answerTransfer = () =>
			Response.json({ error: 'Insufficient funds', status: 402 }, { status: 402 });

		const report = await refund();

		expect(report.refunded).toBe(false);
		expect(report.sent).toEqual([]);
		expect(report.skipped.map((line) => line.reason)).toEqual([
			'transfer_failed',
			'transfer_failed'
		]);
		expect(report.needs_a_person).toBe(false);
		expect(transfers()).toHaveLength(2);
		expect(await refundedAt(contractorDeposits[0]!)).toBeNull();
		expect((await roofRefunds()).map((row) => row.status)).toEqual(['failed', 'failed']);
		expect(await test.db.select().from(refundDeposits)).toEqual([]);

		// The wallet is topped up and someone asks again: each party is paid, once.
		answerTransfer = accepted;
		const later = await refund();
		expect(later.sent).toHaveLength(2);
		expect(transfers()).toHaveLength(4);
		expect(await refundedAt(contractorDeposits[0]!)).not.toBeNull();
		expect((await refund()).sent).toEqual([]);
		expect(transfers()).toHaveLength(4);
	});

	it('never sends again after a timeout, because the money may have moved', async () => {
		const { contractorDeposits, headTeacherDeposits } = await confirmedRoof();
		answerTransfer = () => {
			throw new DOMException('The operation timed out.', 'TimeoutError');
		};

		const report = await refund();

		expect(report.sent).toEqual([]);
		expect(report.skipped.map((line) => line.reason)).toEqual([
			'transfer_outcome_unknown',
			'transfer_outcome_unknown'
		]);
		expect(report.needs_a_person).toBe(true);
		expect(transfers()).toHaveLength(2);
		const recorded = await roofRefunds();
		expect(recorded.map((row) => row.status)).toEqual(['unknown', 'unknown']);
		expect(recorded[0]!.statusReason).toContain('QatomTimeoutError');
		// Not marked refunded: we do not know that they were.
		expect(await refundedAt(contractorDeposits[0]!)).toBeNull();

		// Qatom is healthy again. Asking again still sends nothing for these deposits.
		answerTransfer = accepted;
		const again = await refund();
		expect(again.sent).toEqual([]);
		expect(again.skipped.map((line) => line.reason)).toEqual([
			'refund_outcome_unknown',
			'refund_outcome_unknown'
		]);
		expect(again.skipped.flatMap((line) => line.deposit_ids).sort()).toEqual(
			[...contractorDeposits, ...headTeacherDeposits].sort()
		);
		expect(again.skipped.every((line) => line.refund_id !== null)).toBe(true);
		expect(again.needs_a_person).toBe(true);
		expect(transfers()).toHaveLength(2);
	});

	it('treats a server error and a dropped connection as unknown too', async () => {
		await confirmedRoof();
		const answers = [
			() => Response.json({ error: 'Internal error', status: 500 }, { status: 500 }),
			() => {
				throw new TypeError('fetch failed');
			}
		];
		answerTransfer = () => answers.shift()!();

		const report = await refund();

		expect(report.skipped.map((line) => line.reason)).toEqual([
			'transfer_outcome_unknown',
			'transfer_outcome_unknown'
		]);
		answerTransfer = accepted;
		expect((await refund()).sent).toEqual([]);
		expect(transfers()).toHaveLength(2);
	});

	it('does not send deposits an interrupted request had already claimed', async () => {
		const { headTeacherDeposits } = await confirmedRoof();
		// As if the server stopped between claiming the deposits and recording the outcome.
		await test.db.batch([
			test.db.insert(refunds).values({
				id: 'rfd-interrupted',
				campaignId: CAMPAIGN,
				milestoneId: MILESTONE,
				partyId: headTeacher.id,
				primaryWalletHostname: headTeacher.primaryWalletHostname!,
				dq: DQ,
				amount: HEAD_TEACHER_TOTAL,
				status: 'started',
				statusReason: null,
				startedAt: '2026-11-13T09:30:00.000Z',
				settledAt: null
			}),
			test.db
				.insert(refundDeposits)
				.values({ depositId: headTeacherDeposits[0]!, refundId: 'rfd-interrupted' })
		]);

		const report = await refund();

		expect(report.sent.map((line) => line.party_id)).toEqual([contractor.id]);
		expect(report.skipped).toEqual([
			expect.objectContaining({
				party_id: headTeacher.id,
				reason: 'refund_in_progress',
				refund_id: 'rfd-interrupted'
			})
		]);
		expect(transfers()).toHaveLength(1);
	});
});

describe('the state each deposit is left in', () => {
	const roofStates = async () => {
		const { deposits: rows, totals } = await listDepositStatuses(test.db, CAMPAIGN, {
			milestoneId: MILESTONE
		});
		return {
			states: [...new Set(rows.map((row) => `${row.label}: ${row.outstandingReason}`))],
			attempts: [...new Set(rows.map((row) => row.refundAttempts))],
			totals
		};
	};
	const ALL = CONTRACTOR_TOTAL + HEAD_TEACHER_TOTAL;

	it('is refund outstanding before anything is asked, and deposit refunded once sent', async () => {
		await confirmedRoof();
		expect(await roofStates()).toEqual({
			states: ['Refund outstanding: not_attempted'],
			attempts: [0],
			totals: { paid: ALL, held: 0, refunded: 0, outstanding: ALL }
		});

		await refund();
		expect(await roofStates()).toEqual({
			states: ['Deposit refunded: null'],
			attempts: [1],
			totals: { paid: ALL, held: 0, refunded: ALL, outstanding: 0 }
		});
	});

	it('stays refund outstanding, and says refused, when Qatom refuses the transfer', async () => {
		await confirmedRoof();
		answerTransfer = () =>
			Response.json({ error: 'Insufficient funds', status: 402 }, { status: 402 });

		await refund();
		expect(await roofStates()).toEqual({
			states: ['Refund outstanding: refused'],
			attempts: [1],
			totals: { paid: ALL, held: 0, refunded: 0, outstanding: ALL }
		});

		// Asked again and accepted: two attempts on record, the second one sent.
		answerTransfer = accepted;
		await refund();
		expect(await roofStates()).toMatchObject({ states: ['Deposit refunded: null'], attempts: [2] });
	});

	it('stays refund outstanding, outcome unknown, after a timeout, and is never called refunded', async () => {
		await confirmedRoof();
		answerTransfer = () => {
			throw new DOMException('The operation timed out.', 'TimeoutError');
		};

		await refund();
		const after = {
			states: ['Refund outstanding: outcome_unknown'],
			attempts: [1],
			totals: { paid: ALL, held: 0, refunded: 0, outstanding: ALL }
		};
		expect(await roofStates()).toEqual(after);

		// Asking again sends nothing and adds no attempt.
		answerTransfer = accepted;
		await refund();
		expect(await roofStates()).toEqual(after);
		expect(transfers()).toHaveLength(2);
	});
});

describe('the digital quantity', () => {
	it('sends nothing when the campaign has no commodity ids', async () => {
		await confirmedRoof();
		await test.db
			.update(campaigns)
			.set({ logWorkCommodityId: null, milestoneHitCommodityId: null })
			.where(eq(campaigns.id, CAMPAIGN));

		const report = await refund();

		expect(report.sent).toEqual([]);
		expect(new Set(report.skipped.map((line) => line.reason))).toEqual(
			new Set(['no_commodity_id'])
		);
		expect(requests).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('looks up each hash from its commodity id, then reads that ledger', async () => {
		await confirmedRoof();

		const report = await refund();

		expect(report.skipped).toEqual([]);
		expect(listingReads()).toHaveLength(2);
		expect(
			ledgerReads()
				.map((request) => request.path)
				.sort()
		).toEqual([LOG_HASH, HIT_HASH].map((hash) => `/v4/commodity/${hash}/transactions`).sort());
		expect(transfers()).toHaveLength(2);
	});

	it('sends nothing for a commodity id Qatom does not know, and reads no ledger for it', async () => {
		await confirmedRoof();
		answerListing = (commodityId) => listing(commodityId, null);

		const report = await refund();

		expect(report.sent).toEqual([]);
		expect(new Set(report.skipped.map((line) => line.reason))).toEqual(
			new Set(['ledger_unavailable'])
		);
		expect(listingReads()).toHaveLength(2);
		expect(ledgerReads()).toEqual([]);
		expect(transfers()).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('sends nothing when the catalog listing fails', async () => {
		await confirmedRoof();
		answerListing = () => Response.json({ error: 'Unavailable', status: 503 }, { status: 503 });

		const report = await refund();

		expect(report.sent).toEqual([]);
		expect(new Set(report.skipped.map((line) => line.reason))).toEqual(
			new Set(['ledger_unavailable'])
		);
		expect(ledgerReads()).toEqual([]);
		expect(transfers()).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('still refunds the item whose id resolves when the other does not', async () => {
		await confirmedRoof();
		answerListing = (commodityId) => listing(commodityId, commodityId === HIT_ID ? HIT_HASH : null);

		const report = await refund();

		expect(ledgerReads().map((request) => request.path)).toEqual([
			`/v4/commodity/${HIT_HASH}/transactions`
		]);
		expect(new Set(report.skipped.map((line) => line.reason))).toEqual(
			new Set(['ledger_unavailable'])
		);
		// Only the two Milestone hit deposits go back: the claim and the confirmation.
		expect(transfers().map((request) => request.body)).toEqual([
			expect.objectContaining({ type: DQ, amount: DEPOSIT_AMOUNT.milestone_hit }),
			expect.objectContaining({ type: DQ, amount: DEPOSIT_AMOUNT.milestone_hit })
		]);
	});

	it('sends nothing when the ledger cannot be read or names no digital quantity', async () => {
		await confirmedRoof();
		answerLedger = (hash) =>
			hash === LOG_HASH
				? Response.json({ error: 'Unavailable', status: 503 }, { status: 503 })
				: Response.json({ calculation: { transactions: [] } });

		const report = await refund();

		expect(report.sent).toEqual([]);
		expect(new Set(report.skipped.map((line) => line.reason))).toEqual(
			new Set(['ledger_unavailable', 'no_dq'])
		);
		expect(transfers()).toEqual([]);
		expect(await roofRefunds()).toEqual([]);
	});

	it('reads each ledger once and sends in the quantity each item was paid in', async () => {
		await confirmedRoof();
		const otherDq = '41dq00000000000000000000000000000000000000000000000000000000000b';
		answerLedger = (hash) =>
			Response.json({
				commodity: { dq: hash === LOG_HASH ? otherDq : DQ },
				calculation: { transactions: [] }
			});

		const report = await refund();

		expect(ledgerReads()).toHaveLength(2);
		expect(listingReads()).toHaveLength(2);
		// The contractor's work logs and claim were paid in different quantities: two transfers.
		expect(report.sent.filter((line) => line.party_id === contractor.id)).toHaveLength(2);
		expect(transfers().map((request) => request.body)).toContainEqual(
			expect.objectContaining({ type: otherDq, amount: 2 * DEPOSIT_AMOUNT.log_work })
		);
		expect(transfers()).toHaveLength(3);
	});
});

describe('the fixtures', () => {
	it('has nothing to send for a milestone whose deposits already went back', async () => {
		await setCommodityIds();
		const answer = await post({ campaign_id: CAMPAIGN, milestone_id: 'm1-foundation' });
		expect(answer.status).toBe(200);
		expect(answer.body).toMatchObject({ refunded: false, sent: [], skipped: [] });
		expect(requests).toEqual([]);
	});
});
