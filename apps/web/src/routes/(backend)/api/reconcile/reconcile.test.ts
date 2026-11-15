// Runs the reconciler through its route against a real, migrated, seeded database, with the
// real merchant account client. Nothing here reaches the network: `fetch` is replaced, in this
// file only, by a stub that answers Qatom's token, catalog listing and ledger endpoints from prepared data.
import { CHECKIN_SECRET_HEADER, DEPOSIT_AMOUNT, type Deposit, type Entry } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaigns,
	getEntry,
	insertCampaignWithPartiesAndMilestones,
	insertEntryWithDeposit,
	listEntries,
	parties
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReconcileSummary } from '#lib/server/backend/reconciler.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const API = 'https://pay.stage.m.todaq.net';
const CAMPAIGN = fixtures.campaign.id;
/** The commodity ids the seeded campaign carries, and the hash Qatom's catalog gives for each. */
const LOG_ID = fixtures.campaign.logWorkCommodityId!;
const HIT_ID = fixtures.campaign.milestoneHitCommodityId!;
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
/** What the catalog listing answers for a commodity id: its hash, or a failure. */
type Listing = string | { status: number } | Error;

let test: TestDatabase;
let ledgers: Record<string, Ledger>;
/** A commodity id that is not here is one Qatom does not know: the listing comes back empty. */
let catalog: Record<number, Listing>;
let requests: { url: string; authorization: string | undefined }[];

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	ledgers = {};
	catalog = { [LOG_ID]: LOG_HASH, [HIT_ID]: HIT_HASH };
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
		const { pathname, searchParams } = new URL(address);
		if (pathname === '/v4/catalog/items') {
			if (searchParams.get('mine') !== 'true' || searchParams.get('active') !== 'all') {
				return Promise.reject(new Error(`unexpected request: ${address}`));
			}
			const commodityId = Number(searchParams.get('commodity_id'));
			const listing = catalog[commodityId];
			if (listing instanceof Error) return Promise.reject(listing);
			if (typeof listing === 'object') {
				return answer({ error: 'Something went wrong', status: listing.status }, listing.status);
			}
			const items =
				listing === undefined
					? []
					: [{ id: 42, commodity_id: commodityId, commodity_hash: listing, active: true }];
			return answer({ items, total: items.length, limit: null, offset: 0 });
		}
		const hash = /^\/v4\/commodity\/(\w+)\/transactions$/.exec(pathname)?.[1];
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

/** Stores the two items' commodity ids on the fixture campaign. The seed already has both. */
async function giveCampaignItems(
	ids: { logWorkCommodityId: number | null; milestoneHitCommodityId: number | null } = {
		logWorkCommodityId: LOG_ID,
		milestoneHitCommodityId: HIT_ID
	}
) {
	await test.db.update(campaigns).set(ids).where(eq(campaigns.id, CAMPAIGN));
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

/** A second campaign's own id, party and wallet. It names the same two items as the first. */
const OTHER_CAMPAIGN = 'harbour-clinic';
const OTHER_PARTY = 'harbour-joinery';
const OTHER_WALLET = 'harbour-joinery-agent.wallets.tejido.example';

/**
 * Adds a second campaign that shares the first one's two items, with one party and one
 * milestone. Pass the contractor's wallet to make its party the same person on both campaigns.
 */
async function addCampaignSharingItems(agentWallet: string = OTHER_WALLET) {
	await insertCampaignWithPartiesAndMilestones(test.db, {
		campaign: {
			...fixtures.campaign,
			id: OTHER_CAMPAIGN,
			title: 'Refit the harbour clinic',
			logWorkCommodityId: LOG_ID,
			milestoneHitCommodityId: HIT_ID
		},
		parties: [
			{
				...contractor,
				id: OTHER_PARTY,
				campaignId: OTHER_CAMPAIGN,
				name: 'Harbour Road Joinery',
				email: 'office@harbourroadjoinery.example',
				reporterCode: 'rc_w5e9r3t7y2u6p4a8s3d7',
				agentWalletHostname: agentWallet as typeof contractor.agentWalletHostname,
				primaryWalletHostname: null
			}
		],
		milestones: [
			{
				...fixtures.milestones[1]!,
				campaignId: OTHER_CAMPAIGN,
				ownerPartyId: OTHER_PARTY,
				confirmerPartyId: OTHER_PARTY
			}
		]
	});
}

/** Saves a work log on the second campaign, filed at the given time. */
async function addOtherCampaignWorkLog(id: string, filedAt: string) {
	const entry = {
		...workLog,
		id,
		campaignId: OTHER_CAMPAIGN,
		partyId: OTHER_PARTY,
		filedAt,
		updatedAt: filedAt
	} as Entry;
	await insertEntryWithDeposit(test.db, entry, {
		id: `dep-${id}`,
		entryId: id,
		amount: DEPOSIT_AMOUNT.log_work,
		refundedAt: null
	});
	return entry;
}

const ledgerReads = (hash: string) =>
	requests.filter((request) => request.url.includes(`/v4/commodity/${hash}/`)).length;

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

	it('looks up each hash from its commodity id, then reads the ledgers, with the merchant account token only', async () => {
		await giveCampaignItems();
		ledgers[LOG_HASH] = [];
		ledgers[HIT_HASH] = [];

		await run();

		expect(requests.map((request) => request.url)).toEqual([
			`${API}/v4/account/oauth/token`,
			`${API}/v4/catalog/items?commodity_id=${LOG_ID}&mine=true&active=all`,
			`${API}/v4/commodity/${LOG_HASH}/transactions`,
			`${API}/v4/catalog/items?commodity_id=${HIT_ID}&mine=true&active=all`,
			`${API}/v4/commodity/${HIT_HASH}/transactions`
		]);
		expect(requests[0]!.authorization).toMatch(/^Basic /);
		for (const request of requests.slice(1)) {
			expect(request.authorization).toBe('Bearer account-token');
		}
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
			{
				commodityId: LOG_ID,
				items: ['log_work'],
				campaignIds: [CAMPAIGN],
				problem: expect.stringContaining('500')
			}
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
		expect(body.ledgerErrors.map((error) => error.items)).toEqual([
			['log_work'],
			['milestone_hit']
		]);
		expect(await allEntries()).toEqual(before);
	});

	it('reports a commodity id Qatom does not know, reads no ledger for it, and still reconciles the other', async () => {
		await giveCampaignItems();
		delete catalog[LOG_ID];
		ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];
		ledgers[HIT_HASH] = [
			sale('41cc', '2026-11-11T11:05:44.000Z', SUPPLIER_WALLET, DEPOSIT_AMOUNT.milestone_hit)
		];

		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toMatchObject({ ledgersRead: 1, matched: 1, stampedIncomplete: 1, unmatched: 1 });
		expect(body.ledgerErrors).toEqual([
			{
				commodityId: LOG_ID,
				items: ['log_work'],
				campaignIds: [CAMPAIGN],
				problem: expect.stringContaining(`no catalog item for commodity id ${LOG_ID}`)
			}
		]);
		expect(requests.some((request) => request.url.includes(`/commodity/${LOG_HASH}/`))).toBe(false);
		expect(await entry(workLog.id)).toEqual(workLog);
		expect((await entry(delivery.id)).twistId).toBe('41cc');
	});

	it('reports a catalog listing Qatom would not give, and stamps nothing for that item', async () => {
		await giveCampaignItems();
		catalog[LOG_ID] = { status: 500 };
		catalog[HIT_ID] = new TypeError('fetch failed');
		ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];
		ledgers[HIT_HASH] = [
			sale('41cc', '2026-11-11T11:05:44.000Z', SUPPLIER_WALLET, DEPOSIT_AMOUNT.milestone_hit)
		];
		const before = await allEntries();

		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toMatchObject({ ledgersRead: 0, matched: 0, unmatched: 2 });
		expect(body.ledgerErrors).toEqual([
			{
				commodityId: LOG_ID,
				items: ['log_work'],
				campaignIds: [CAMPAIGN],
				problem: expect.stringContaining('500')
			},
			{
				commodityId: HIT_ID,
				items: ['milestone_hit'],
				campaignIds: [CAMPAIGN],
				problem: expect.stringContaining('could not be reached')
			}
		]);
		expect(requests.some((request) => request.url.includes('/v4/commodity/'))).toBe(false);
		expect(await allEntries()).toEqual(before);
	});

	it('skips a campaign with no commodity ids without calling Qatom', async () => {
		await giveCampaignItems({ logWorkCommodityId: null, milestoneHitCommodityId: null });
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
		await giveCampaignItems({ logWorkCommodityId: LOG_ID, milestoneHitCommodityId: null });
		ledgers[LOG_HASH] = [sale('41aa', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];

		const { body } = await run();

		expect(body).toMatchObject({ campaigns: 1, ledgersRead: 1, verified: 1, unmatched: 1 });
		expect(requests.filter((request) => request.url.includes('/v4/commodity/'))).toHaveLength(1);
		expect(requests.filter((request) => request.url.includes('/v4/catalog/items'))).toHaveLength(1);
	});

	describe('when two campaigns share the same items', () => {
		it('reads the shared ledger once and gives each campaign’s entry its own transaction', async () => {
			await addCampaignSharingItems();
			// Filed 21 seconds after the first campaign's work log: both payments fit both windows.
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			ledgers[LOG_HASH] = [
				sale('41other', '2026-11-13T17:02:31.000Z', OTHER_WALLET),
				sale('41own', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)
			];
			ledgers[HIT_HASH] = [];

			const { body } = await run();

			expect(body).toEqual({
				campaigns: 2,
				campaignsWithoutItems: 0,
				// One work-log ledger and one milestone ledger, however many campaigns name them.
				ledgersRead: 2,
				ledgerErrors: [],
				matched: 2,
				verified: 2,
				flagged: 0,
				stampedIncomplete: 0,
				unmatched: 1,
				ambiguous: 0,
				waitingForWallet: 0,
				unreadableTransactions: 0
			} satisfies ReconcileSummary);
			expect(ledgerReads(LOG_HASH)).toBe(1);
			expect(ledgerReads(HIT_HASH)).toBe(1);
			expect(await entry(workLog.id)).toMatchObject({ status: 'verified', twistId: '41own' });
			expect(await entry(other.id)).toMatchObject({
				status: 'verified',
				twistId: '41other',
				payingWallet: OTHER_WALLET
			});
		});

		it('does not give one campaign’s payment to another campaign’s entry as a stranger’s', async () => {
			await addCampaignSharingItems();
			// The contractor filed twice a minute apart and one payment shows: which entry it paid
			// for cannot be told. The other campaign's entry is in the same window, unpaid so far.
			const second = await addWorkLog('ent-second', '2026-11-13T17:03:19.000Z');
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			ledgers[LOG_HASH] = [sale('41own', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];
			ledgers[HIT_HASH] = [];

			const { body } = await run();

			expect(body).toMatchObject({ matched: 0, flagged: 0, unmatched: 4, ambiguous: 2 });
			expect(await entry(other.id)).toEqual(other);
			expect(await entry(workLog.id)).toEqual(workLog);
			expect(await entry(second.id)).toEqual(second);
		});

		it('records nothing when one person files on both campaigns and one payment fits both', async () => {
			// The same person, with the same agent wallet, is a party on both campaigns.
			await addCampaignSharingItems(CONTRACTOR_WALLET);
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			ledgers[LOG_HASH] = [sale('41own', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)];
			ledgers[HIT_HASH] = [];

			const { body } = await run();

			expect(body).toMatchObject({ matched: 0, verified: 0, unmatched: 3, ambiguous: 2 });
			expect(await entry(workLog.id)).toEqual(workLog);
			expect(await entry(other.id)).toEqual(other);
		});

		it('records nothing when one person files on both campaigns and two payments fit both', async () => {
			await addCampaignSharingItems(CONTRACTOR_WALLET);
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			ledgers[LOG_HASH] = [
				sale('41one', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET),
				sale('41two', '2026-11-13T17:02:31.000Z', CONTRACTOR_WALLET)
			];
			ledgers[HIT_HASH] = [];

			expect((await run()).body).toMatchObject({ matched: 0, unmatched: 3, ambiguous: 2 });
			expect(await entry(workLog.id)).toEqual(workLog);
			expect(await entry(other.id)).toEqual(other);
		});

		it('matches one person’s entries on both campaigns when they are far enough apart to tell', async () => {
			await addCampaignSharingItems(CONTRACTOR_WALLET);
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:20:19.000Z');
			ledgers[LOG_HASH] = [
				sale('41one', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET),
				sale('41two', '2026-11-13T17:20:10.000Z', CONTRACTOR_WALLET)
			];
			ledgers[HIT_HASH] = [];

			expect((await run()).body).toMatchObject({ matched: 2, verified: 2, ambiguous: 0 });
			expect((await entry(workLog.id)).twistId).toBe('41one');
			expect((await entry(other.id)).twistId).toBe('41two');
		});

		it('flags neither entry when a stranger’s payment fits one on each campaign', async () => {
			await addCampaignSharingItems();
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			ledgers[LOG_HASH] = [sale('41zz', '2026-11-13T17:02:15.000Z', STRANGER)];
			ledgers[HIT_HASH] = [];

			const { body } = await run();

			expect(body).toMatchObject({ matched: 0, flagged: 0, unmatched: 3, ambiguous: 2 });
			expect(await entry(workLog.id)).toEqual(workLog);
			expect(await entry(other.id)).toEqual(other);
		});

		it('keeps a transaction for an entry whose party has no wallet yet, on another campaign', async () => {
			await addCampaignSharingItems();
			await test.db
				.update(parties)
				.set({ agentWalletHostname: null })
				.where(eq(parties.id, OTHER_PARTY));
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			// It may be the payment of the party who has not linked a wallet: not the contractor's.
			ledgers[LOG_HASH] = [sale('41zz', '2026-11-13T17:02:15.000Z', STRANGER)];
			ledgers[HIT_HASH] = [];

			const { body } = await run();

			expect(body).toMatchObject({ matched: 0, flagged: 0, unmatched: 3, waitingForWallet: 1 });
			expect(await entry(workLog.id)).toEqual(workLog);
			expect(await entry(other.id)).toEqual(other);
		});

		it('reports a shared ledger Qatom would not give once, naming both campaigns', async () => {
			await addCampaignSharingItems();
			const other = await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			ledgers[LOG_HASH] = { status: 500 };
			ledgers[HIT_HASH] = [];

			const { body } = await run();

			expect(body).toMatchObject({ campaigns: 2, ledgersRead: 1, matched: 0, unmatched: 3 });
			expect(body.ledgerErrors).toEqual([
				{
					commodityId: LOG_ID,
					items: ['log_work'],
					campaignIds: [CAMPAIGN, OTHER_CAMPAIGN],
					problem: expect.stringContaining('500')
				}
			]);
			expect(ledgerReads(LOG_HASH)).toBe(1);
			expect(await entry(other.id)).toEqual(other);
		});

		it('changes nothing on a second run', async () => {
			await addCampaignSharingItems();
			await addOtherCampaignWorkLog('ent-other', '2026-11-13T17:02:40.000Z');
			ledgers[LOG_HASH] = [
				sale('41other', '2026-11-13T17:02:31.000Z', OTHER_WALLET),
				sale('41own', '2026-11-13T17:02:10.000Z', CONTRACTOR_WALLET)
			];
			ledgers[HIT_HASH] = [];

			const first = await run();
			const after = [...(await allEntries()), ...(await listEntries(test.db, OTHER_CAMPAIGN))];
			const second = await run();

			expect(first.body).toMatchObject({ matched: 2, verified: 2, unmatched: 1 });
			expect(second.body).toMatchObject({ matched: 0, verified: 0, unmatched: 1 });
			expect([...(await allEntries()), ...(await listEntries(test.db, OTHER_CAMPAIGN))]).toEqual(
				after
			);
		});
	});
});
