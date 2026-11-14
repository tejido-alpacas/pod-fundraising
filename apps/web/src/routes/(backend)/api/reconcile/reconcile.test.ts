// Runs the reconciler through its route against a real, migrated, seeded database, with the
// real merchant account client. Nothing here reaches the network: `fetch` is replaced, in this
// file only, by a stub that answers Qatom's token and ledger endpoints from prepared data.
import { CHECKIN_SECRET_HEADER, DEPOSIT_AMOUNT, type Deposit, type Entry } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, getEntry, insertEntryWithDeposit, listEntries, parties } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReconcileSummary } from '#lib/server/backend/reconciler.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const API = 'https://pay.stage.m.todaq.net';
const CAMPAIGN = fixtures.campaign.id;
const LOG_HASH = 'loghash111';
const HIT_HASH = 'hithash222';

const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
/** The contractor's work log, saved as `filed` at 17:02:19 and not reconciled. */
const workLog = fixtures.entries.find((entry) => entry.id === 'ent-m2-log-2')!;
/** The supplier's delivery claim, saved as `incomplete` at 11:05:52 and not reconciled. */
const delivery = fixtures.entries.find((entry) => entry.id === 'ent-m3-delivery')!;
const CONTRACTOR_WALLET = contractor.agentWalletHostname!;
const SUPPLIER_WALLET = supplier.agentWalletHostname!;
const STRANGER = 'someone-else.wallets.tejido.example';

type Ledger = Record<string, unknown>[] | { status: number } | Error;

let test: TestDatabase;
let ledgers: Record<string, Ledger>;
let requests: { url: string; authorization: string | undefined }[];

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	ledgers = {};
	requests = [];
	vi.stubGlobal('fetch', (url: string | URL, init: RequestInit = {}) => {
		const address = String(url);
		requests.push({
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
		const hash = /^\/v4\/commodity\/(\w+)\/transactions$/.exec(new URL(address).pathname)?.[1];
		const ledger = hash === undefined ? undefined : ledgers[hash];
		if (ledger === undefined) return Promise.reject(new Error(`unexpected request: ${address}`));
		if (ledger instanceof Error) return Promise.reject(ledger);
		if (!Array.isArray(ledger)) {
			return answer({ error: 'Something went wrong', status: ledger.status }, ledger.status);
		}
		return answer({
			commodity: { hash, dq: '41dq' },
			calculation: { transactionCount: ledger.length, transactions: ledger }
		});
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await test.destroy();
});

/** Stores the two items' commodity hashes on the fixture campaign, as C2 will. */
async function giveCampaignItems(
	hashes: { logWorkCommodityHash?: string | null; milestoneHitCommodityHash?: string | null } = {
		logWorkCommodityHash: LOG_HASH,
		milestoneHitCommodityHash: HIT_HASH
	}
) {
	await test.db.update(campaigns).set(hashes).where(eq(campaigns.id, CAMPAIGN));
}

/** One ledger row, as Qatom returns it. */
function sale(
	twistId: string,
	timestamp: string,
	fromAddress: string,
	amount: number = DEPOSIT_AMOUNT.log_work
) {
	return {
		twistId,
		timestamp,
		amount,
		fromAddress,
		destinationAddress: 'item.wallets.tejido.example',
		operation: 'transfer'
	};
}

/** Saves another work log by the contractor, filed at the given time. */
async function addWorkLog(id: string, filedAt: string) {
	const entry = { ...workLog, id, filedAt, updatedAt: filedAt } as Entry;
	const deposit: Deposit = {
		id: `dep-${id}`,
		entryId: id,
		amount: DEPOSIT_AMOUNT.log_work,
		refundedAt: null
	};
	await insertEntryWithDeposit(test.db, entry, deposit);
	return entry;
}

async function run(headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }) {
	const request = new Request('http://localhost/api/reconcile', { method: 'POST', headers });
	const account = createMerchantAccount({
		paymentApiUrl: API,
		clientId: 'merchant-account-id',
		clientSecret: 'merchant-account-secret'
	});
	const locals = {
		ctx: { db: test.db, config: { CHECKIN_SHARED_SECRET: SECRET }, qatom: { account } }
	};
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	return { status: response.status, body: (await response.json()) as ReconcileSummary };
}

const entry = async (id: string) => (await getEntry(test.db, id))!;
const allEntries = () => listEntries(test.db, CAMPAIGN);

describe('POST /api/reconcile', () => {
	it('refuses a caller without the shared secret, and reads no ledger', async () => {
		await giveCampaignItems();

		expect((await run({})).status).toBe(401);
		expect((await run({ [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect(requests).toEqual([]);
		expect(await entry(workLog.id)).toEqual(workLog);
	});

	it('verifies an entry paid from the registered agent wallet', async () => {
		await giveCampaignItems();
		// The ledger may give the address as a twin URL; the registered wallet is a bare hostname.
		ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', `https://${CONTRACTOR_WALLET}`)];
		ledgers[HIT_HASH] = [];

		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toEqual({
			campaigns: 1,
			campaignsWithoutItems: 0,
			ledgersRead: 2,
			ledgerErrors: [],
			matched: 1,
			verified: 1,
			flagged: 0,
			stampedIncomplete: 0,
			unmatched: 1,
			ambiguous: 0,
			waitingForWallet: 0,
			unreadableTransactions: 0
		} satisfies ReconcileSummary);
		expect(await entry(workLog.id)).toEqual({
			...workLog,
			status: 'verified',
			statusReason: null,
			twistId: '41aa',
			payingWallet: `https://${CONTRACTOR_WALLET}`,
			stampedAt: '2026-11-13T17:02:10.000Z',
			updatedAt: expect.any(String)
		});
		expect(await entry(delivery.id)).toEqual(delivery);
	});

	it('reads ledgers with the merchant account token only', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [];
		ledgers[HIT_HASH] = [];

		await run();

		expect(requests.map((request) => request.url)).toEqual([
			`${API}/v4/account/oauth/token`,
			`${API}/v4/commodity/${LOG_HASH}/transactions`,
			`${API}/v4/commodity/${HIT_HASH}/transactions`
		]);
		expect(requests[0]!.authorization).toMatch(/^Basic /);
		expect(requests[1]!.authorization).toBe('Bearer account-token');
		expect(requests[2]!.authorization).toBe('Bearer account-token');
	});

	it('flags an entry paid from a different wallet, with a reason a donor can read', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [sale('41bb', '2026-11-13T17:02:10.000Z', STRANGER)];
		ledgers[HIT_HASH] = [];

		const { body } = await run();

		expect(body).toMatchObject({ matched: 1, verified: 0, flagged: 1, unmatched: 1 });
		expect(await entry(workLog.id)).toMatchObject({
			status: 'flagged',
			statusReason:
				'The deposit was paid from a wallet that is not the one registered for Coral Ridge Builders.',
			twistId: '41bb',
			payingWallet: STRANGER,
			stampedAt: '2026-11-13T17:02:10.000Z'
		});
	});

	it("flags an entry paid from the party's primary wallet: only the agent wallet counts", async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [
			sale('41pp', '2026-11-13T17:02:10.000Z', contractor.primaryWalletHostname!)
		];
		ledgers[HIT_HASH] = [];

		expect((await run()).body).toMatchObject({ verified: 0, flagged: 1 });
		expect((await entry(workLog.id)).status).toBe('flagged');
	});

	it('prefers the transaction from the registered wallet over another in the same window', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [
			sale('41stranger', '2026-11-13T17:02:12.000Z', STRANGER),
			sale('41own', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)
		];
		ledgers[HIT_HASH] = [];

		expect((await run()).body).toMatchObject({ matched: 1, verified: 1, flagged: 0 });
		expect(await entry(workLog.id)).toMatchObject({ status: 'verified', twistId: '41own' });
	});

	it('records the transaction on an incomplete entry but keeps it incomplete', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [];
		ledgers[HIT_HASH] = [
			sale('41cc', '2026-11-11T11:05:44.000Z', SUPPLIER_WALLET, DEPOSIT_AMOUNT.milestone_hit)
		];

		const { body } = await run();

		expect(body).toMatchObject({
			matched: 1,
			verified: 0,
			flagged: 0,
			stampedIncomplete: 1,
			unmatched: 1
		});
		expect(await entry(delivery.id)).toMatchObject({
			status: 'incomplete',
			statusReason: delivery.statusReason,
			twistId: '41cc',
			payingWallet: SUPPLIER_WALLET,
			stampedAt: '2026-11-11T11:05:44.000Z'
		});
	});

	it('flags an incomplete entry paid from a different wallet, keeping what was missing', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [];
		ledgers[HIT_HASH] = [
			sale('41dd', '2026-11-11T11:05:44.000Z', STRANGER, DEPOSIT_AMOUNT.milestone_hit)
		];

		expect((await run()).body).toMatchObject({ flagged: 1, stampedIncomplete: 0 });
		expect(await entry(delivery.id)).toMatchObject({
			status: 'flagged',
			statusReason:
				'The deposit was paid from a wallet that is not the one registered for Island Schoolbooks Co-operative. A delivery needs a quantity and a unit.',
			twistId: '41dd'
		});
	});

	it('leaves an entry alone when no transaction fits it', async () => {
		await giveCampaignItems();
		const usedAlready = fixtures.entries.find((item) => item.id === 'ent-m2-log-1')!.twistId!;
		ledgers[LOG_HASH] = [
			// The wrong amount.
			sale('41amount', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET, DEPOSIT_AMOUNT.milestone_hit),
			// Too long before the entry was saved, and too long after.
			sale('41early', '2026-11-13T16:50:00.000Z', CONTRACTOR_WALLET),
			sale('41late', '2026-11-13T17:05:00.000Z', CONTRACTOR_WALLET),
			// Already the proof of another entry.
			sale(usedAlready, '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)
		];
		ledgers[HIT_HASH] = [];
		const before = await allEntries();

		const { body } = await run();

		expect(body).toMatchObject({ matched: 0, unmatched: 2, ambiguous: 0, ledgerErrors: [] });
		expect(await allEntries()).toEqual(before);
	});

	it('counts a ledger row whose time cannot be read, and does not use it', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [
			sale('41when', 'yesterday', CONTRACTOR_WALLET),
			{ twistId: '41bare', timestamp: '2026-11-13T17:02:10.000Z' }
		];
		ledgers[HIT_HASH] = [];

		expect((await run()).body).toMatchObject({ matched: 0, unreadableTransactions: 2 });
		expect(await entry(workLog.id)).toEqual(workLog);
	});

	it('changes nothing on a second run', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [
			sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET),
			sale('41zz', '2026-11-13T17:02:15.000Z', STRANGER)
		];
		ledgers[HIT_HASH] = [
			sale('41dd', '2026-11-11T11:05:44.000Z', STRANGER, DEPOSIT_AMOUNT.milestone_hit)
		];

		const first = await run();
		const after = await allEntries();
		const second = await run();

		expect(first.body).toMatchObject({ matched: 2, verified: 1, flagged: 1, unmatched: 0 });
		expect(second.body).toMatchObject({ matched: 0, verified: 0, flagged: 0, unmatched: 0 });
		expect(await allEntries()).toEqual(after);
	});

	it('stamps one entry at most with one transaction: a later entry does not reuse it', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];
		ledgers[HIT_HASH] = [];
		await run();
		// A second work log arrives a minute later; the ledger does not show its payment yet.
		const later = await addWorkLog('ent-later', '2026-11-13T17:03:19.000Z');

		const { body } = await run();

		// The later work log and the delivery claim are both still waiting.
		expect(body).toMatchObject({ matched: 0, unmatched: 2 });
		expect(await entry(later.id)).toEqual(later);
		expect((await entry(workLog.id)).twistId).toBe('41aa');
	});

	describe('when the pairing is ambiguous', () => {
		it('records nothing for two entries by one party that two transactions both fit', async () => {
			await giveCampaignItems();
			const second = await addWorkLog('ent-second', '2026-11-13T17:03:19.000Z');
			ledgers[LOG_HASH] = [
				sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET),
				sale('41bb', '2026-11-13T17:03:10.000Z', CONTRACTOR_WALLET)
			];
			ledgers[HIT_HASH] = [];

			const { body } = await run();

			expect(body).toMatchObject({ matched: 0, verified: 0, unmatched: 3, ambiguous: 2 });
			expect(await entry(workLog.id)).toEqual(workLog);
			expect(await entry(second.id)).toEqual(second);
		});

		it('records nothing for two entries that one transaction fits', async () => {
			await giveCampaignItems();
			const second = await addWorkLog('ent-second', '2026-11-13T17:03:19.000Z');
			ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];
			ledgers[HIT_HASH] = [];

			expect((await run()).body).toMatchObject({ matched: 0, ambiguous: 2 });
			expect(await entry(workLog.id)).toEqual(workLog);
			expect(await entry(second.id)).toEqual(second);
		});

		it('does not flag an entry with a stranger’s transaction while its own are ambiguous', async () => {
			await giveCampaignItems();
			await addWorkLog('ent-second', '2026-11-13T17:03:19.000Z');
			ledgers[LOG_HASH] = [
				sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET),
				sale('41bb', '2026-11-13T17:03:10.000Z', CONTRACTOR_WALLET),
				sale('41zz', '2026-11-13T17:02:30.000Z', STRANGER)
			];
			ledgers[HIT_HASH] = [];

			expect((await run()).body).toMatchObject({ matched: 0, flagged: 0, ambiguous: 2 });
		});

		it('matches both entries when they are far enough apart to tell', async () => {
			await giveCampaignItems();
			const second = await addWorkLog('ent-second', '2026-11-13T17:20:19.000Z');
			ledgers[LOG_HASH] = [
				sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET),
				sale('41bb', '2026-11-13T17:20:10.000Z', CONTRACTOR_WALLET)
			];
			ledgers[HIT_HASH] = [];

			expect((await run()).body).toMatchObject({ matched: 2, verified: 2, ambiguous: 0 });
			expect((await entry(workLog.id)).twistId).toBe('41aa');
			expect((await entry(second.id)).twistId).toBe('41bb');
		});
	});

	it('leaves an entry waiting, not flagged, while its party has no wallet linked', async () => {
		await giveCampaignItems();
		await test.db
			.update(parties)
			.set({ agentWalletHostname: null, primaryWalletHostname: null })
			.where(eq(parties.id, contractor.id));
		ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];
		ledgers[HIT_HASH] = [];

		const { body } = await run();

		expect(body).toMatchObject({ matched: 0, flagged: 0, unmatched: 2, waitingForWallet: 1 });
		expect(await entry(workLog.id)).toEqual(workLog);
	});

	it('reports a ledger Qatom would not give, and still reconciles the other', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = { status: 500 };
		ledgers[HIT_HASH] = [
			sale('41cc', '2026-11-11T11:05:44.000Z', SUPPLIER_WALLET, DEPOSIT_AMOUNT.milestone_hit)
		];

		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toMatchObject({ ledgersRead: 1, matched: 1, stampedIncomplete: 1, unmatched: 1 });
		expect(body.ledgerErrors).toEqual([
			{ campaignId: CAMPAIGN, item: 'log_work', problem: expect.stringContaining('500') }
		]);
		expect(await entry(workLog.id)).toEqual(workLog);
		expect((await entry(delivery.id)).twistId).toBe('41cc');
	});

	it('reports a ledger that could not be reached', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = new TypeError('fetch failed');
		ledgers[HIT_HASH] = new TypeError('fetch failed');
		const before = await allEntries();

		const { body } = await run();

		expect(body).toMatchObject({ ledgersRead: 0, matched: 0, unmatched: 2 });
		expect(body.ledgerErrors.map((error) => error.item)).toEqual(['log_work', 'milestone_hit']);
		expect(await allEntries()).toEqual(before);
	});

	it('skips a campaign with no commodity hashes without calling Qatom', async () => {
		const before = await allEntries();

		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toMatchObject({
			campaigns: 0,
			campaignsWithoutItems: 1,
			ledgersRead: 0,
			matched: 0,
			unmatched: 0
		});
		expect(requests).toEqual([]);
		expect(await allEntries()).toEqual(before);
	});

	it('reads only the ledger of the item a campaign has', async () => {
		await giveCampaignItems({ logWorkCommodityHash: LOG_HASH });
		ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];

		const { body } = await run();

		expect(body).toMatchObject({ campaigns: 1, ledgersRead: 1, verified: 1, unmatched: 1 });
		expect(requests.filter((request) => request.url.includes('/commodity/'))).toHaveLength(1);
	});
});
