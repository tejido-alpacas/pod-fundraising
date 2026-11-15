// The cleanup of the campaigns the automatic end-to-end tests create: what it deletes, and
// the proof of what it can never delete.
//
// Calls the endpoint's own handler against a real, migrated, seeded local D1, which enforces
// foreign keys as the deployed one does.
//
// NOTHING HERE REACHES QATOM OR ANY NETWORK. `fetch` is replaced for every test and fails the
// test if it is called at all: the cleanup calls nothing.
import { CHECKIN_SECRET_HEADER, DEPOSIT_AMOUNT } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaignFunding,
	campaigns,
	deposits,
	donations,
	E2E_CAMPAIGN_ID,
	entries,
	evidenceFiles,
	itemProvisioning,
	milestones,
	parties,
	partySignInTokens,
	refundAttempts,
	refundDeposits,
	refunds,
	reminders,
	schema,
	workLogSchedules
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { E2E_TEST_EMAIL_DOMAIN } from '@tejido/qatom/account';
import { eq, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	FORCE_AGE_MS,
	MIN_AGE_MS,
	PASS_LIMIT,
	type CleanupReport
} from '#lib/server/backend/test-campaign-cleanup.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const HOUR = 60 * 60_000;
const REAL_CAMPAIGN = fixtures.campaign.id;
const templateParty = fixtures.parties[0]!;
const templateLog = fixtures.entries.find((entry) => entry.item === 'log_work')!;
const templateHit = fixtures.entries.find((entry) => entry.item === 'milestone_hit')!;

const CREATOR = `e2e-creator@${E2E_TEST_EMAIL_DOMAIN}`;
const CONTRACTOR = `tejido-contractor@${E2E_TEST_EMAIL_DOMAIN}`;
const CONFIRMER = `tejido-confirmer@${E2E_TEST_EMAIL_DOMAIN}`;

/** The public test picture: the same bytes, so the same fingerprint, on every run. */
const PUBLIC_PICTURE = 'aa'.repeat(32);
/** The picture a run's contractor keeps from donors: bytes of its own for each campaign. */
const privatePicture = (campaignId: string) =>
	Buffer.from(campaignId).toString('hex').padEnd(64, '0').slice(0, 64);

let test: TestDatabase;
let logged: string;
let sequence: number;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	sequence = 0;
	logged = '';
	const keep = (...parts: unknown[]) => {
		logged += `${parts.map(String).join(' ')}\n`;
	};
	vi.spyOn(console, 'log').mockImplementation(keep);
	vi.spyOn(console, 'error').mockImplementation(keep);
	vi.stubGlobal('fetch', () => {
		throw new Error('The cleanup made a network request. It must make none.');
	});
});
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await test?.destroy();
});

// --- Making campaigns --------------------------------------------------------------------

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

interface Made {
	/** How long ago it was created. */
	age: number;
	creatorEmail?: string;
	contractorEmail?: string;
	confirmerEmail?: string;
	/** False leaves the three deposits unrefunded, with no refund on record. */
	refunded?: boolean;
	/** The status of the refund on record, when `refunded` is true. */
	refundStatus?: 'sent' | 'started' | 'unknown';
	/** Adds one donation. */
	donation?: boolean;
	/** False: the contractor uploads no picture of their own. */
	ownPicture?: boolean;
	/** True: this campaign's contractor is the first uploader of the public picture. */
	ownsPublicPicture?: boolean;
}

/**
 * A campaign as one paid run leaves it, with a row in EVERY table that can belong to a
 * campaign: two people, three milestones, a work log, a claim and its confirmation, their
 * deposits and the refund that sent them back, evidence, reminders, sign-in tokens, funding
 * totals, item provisioning and a work-log schedule.
 */
async function makeCampaign(id: string, made: Made) {
	const {
		creatorEmail = CREATOR,
		contractorEmail = CONTRACTOR,
		confirmerEmail = CONFIRMER,
		refunded = true,
		refundStatus = 'sent',
		ownPicture = true
	} = made;
	const createdAt = ago(made.age);
	const contractor = `${id}-contractor`;
	const confirmer = `${id}-confirmer`;
	const db = test.db;

	await db.insert(campaigns).values({
		...fixtures.campaign,
		id,
		title: `Automatic test, run ${id} (not a real fundraiser)`,
		creatorEmail,
		status: 'reporting',
		logWorkCommodityId: null,
		milestoneHitCommodityId: null,
		createdAt
	});
	for (const [partyId, role, email] of [
		[contractor, 'third_party', contractorEmail],
		[confirmer, 'confirmer', confirmerEmail]
	] as const) {
		await db.insert(parties).values({
			...templateParty,
			id: partyId,
			campaignId: id,
			role,
			email,
			reporterCode: `code-${partyId}`,
			agentWalletHostname: null,
			primaryWalletHostname: null,
			createdAt
		});
	}
	await db.insert(milestones).values(
		['m1', 'm2', 'm3'].map((milestoneId, index) => ({
			campaignId: id,
			id: milestoneId,
			position: index + 1,
			title: `Test milestone ${index + 1}`,
			description: '',
			kind: 'service' as const,
			ownerPartyId: contractor,
			confirmerPartyId: confirmer,
			dueDate: '2027-11-15',
			state: index === 0 ? ('confirmed_independent' as const) : ('open' as const),
			confirmedAt: index === 0 ? createdAt : null
		}))
	);

	const photo = (sha256: string) => ({
		url: `https://app.tejido.example/evidence/${sha256}.png`,
		sha256,
		caption: 'A test picture'
	});
	const depositIds: string[] = [];
	const file = async (partyId: string, item: 'log_work' | 'milestone_hit', photos: string[]) => {
		sequence += 1;
		const entryId = `${id}-ent-${sequence}`;
		const template = item === 'log_work' ? templateLog : templateHit;
		await db.insert(entries).values({
			...template,
			id: entryId,
			campaignId: id,
			milestoneId: 'm1',
			partyId,
			inputs: { ...template.inputs, milestone_id: 'm1', photos: photos.map(photo) },
			status: 'verified',
			statusReason: null,
			payingWallet: 'some-agent.micro.biz.todaq.net',
			twistId: `41twist-${id}-${sequence}`,
			filedAt: createdAt,
			stampedAt: createdAt,
			updatedAt: createdAt
		});
		const depositId = `${id}-dep-${sequence}`;
		await db.insert(deposits).values({
			id: depositId,
			entryId,
			amount: DEPOSIT_AMOUNT[item],
			refundedAt: refunded && refundStatus === 'sent' ? createdAt : null
		});
		depositIds.push(depositId);
	};
	const own = ownPicture ? [privatePicture(id)] : [];
	await file(contractor, 'log_work', [PUBLIC_PICTURE]);
	await file(contractor, 'milestone_hit', [PUBLIC_PICTURE, ...own]);
	await file(confirmer, 'milestone_hit', []);

	if (refunded) {
		const refundId = `${id}-rfd`;
		await db.insert(refunds).values({
			id: refundId,
			campaignId: id,
			milestoneId: 'm1',
			partyId: contractor,
			primaryWalletHostname: null,
			agentWalletHostname: templateParty.agentWalletHostname,
			dq: '41dq',
			amount: 2100,
			status: refundStatus,
			statusReason: null,
			startedAt: createdAt,
			settledAt: refundStatus === 'sent' ? createdAt : null
		});
		await db
			.insert(refundDeposits)
			.values(depositIds.map((depositId) => ({ depositId, refundId })));
		await db
			.insert(refundAttempts)
			.values(depositIds.map((depositId) => ({ depositId, refundId })));
	}

	const evidence = (sha256: string, visibility: 'public' | 'not_public') => ({
		sha256,
		uploadedByPartyId: contractor,
		visibility,
		notPublicKind: visibility === 'public' ? null : 'A test picture',
		notPublicReason: visibility === 'public' ? null : 'Kept from donors by a test',
		createdAt,
		updatedAt: createdAt
	});
	if (ownPicture) await db.insert(evidenceFiles).values(evidence(privatePicture(id), 'not_public'));
	if (made.ownsPublicPicture) {
		await db.insert(evidenceFiles).values(evidence(PUBLIC_PICTURE, 'public'));
	}

	await db.insert(reminders).values({
		id: `${id}-rem`,
		campaignId: id,
		partyId: contractor,
		what: 'milestone',
		subject: 'm2',
		kind: 'due',
		dueDate: '2027-11-15',
		raisedAt: createdAt
	});
	await db
		.insert(partySignInTokens)
		.values({ partyId: contractor, sealedTokens: 'sealed', updatedAt: createdAt });
	await db
		.insert(campaignFunding)
		.values({ campaignId: id, raised: 0, donations: 0, readAt: createdAt });
	await db
		.insert(itemProvisioning)
		.values({ campaignId: id, item: 'log_work', updatedAt: createdAt });
	await db
		.insert(workLogSchedules)
		.values({ campaignId: id, startedOn: '2026-11-15', recordedAt: createdAt });
	if (made.donation) {
		await db.insert(donations).values({
			id: `${id}-don`,
			campaignId: id,
			amount: 1000,
			paymentDigest: null,
			receivedAt: createdAt
		});
	}
}

/** The fixed test campaign, as the fixture makes it, with entries that name the public picture. */
async function fixedCampaign(age: number, options: { ownsPublicPicture?: boolean } = {}) {
	await makeCampaign(E2E_CAMPAIGN_ID, { age, ownPicture: false, ...options });
}

// --- Looking at the database -------------------------------------------------------------

const tables: SQLiteTable[] = [];
for (const value of Object.values(schema)) {
	if (is(value, SQLiteTable)) tables.push(value);
}

/** Every row of every table, as text: two equal snapshots mean nothing at all changed. */
async function snapshot(): Promise<Record<string, string[]>> {
	const all: Record<string, string[]> = {};
	for (const table of tables) {
		const rows = await test.db.select().from(table);
		all[getTableConfig(table).name] = rows.map((row) => JSON.stringify(row)).sort();
	}
	return all;
}

/** How many rows in the whole database mention this text anywhere. */
async function rowsMentioning(text: string): Promise<number> {
	const all = await snapshot();
	return Object.values(all)
		.flat()
		.filter((row) => row.includes(text)).length;
}

const exists = async (campaignId: string) =>
	(await test.db.select().from(campaigns).where(eq(campaigns.id, campaignId))).length === 1;

// --- Calling the endpoint ----------------------------------------------------------------

async function pass(headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }) {
	const request = new Request('http://localhost/api/test-campaign-cleanup', {
		method: 'POST',
		headers
	});
	const locals = { ctx: { db: test.db, config: { CHECKIN_SHARED_SECRET: SECRET } }, session: null };
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	const text = await response.text();
	return { status: response.status, text, report: JSON.parse(text) as CleanupReport };
}

const leftReasons = (report: CleanupReport) =>
	Object.fromEntries(report.left.map(({ campaign_id, reason }) => [campaign_id, reason]));

// -----------------------------------------------------------------------------------------

describe('POST /api/test-campaign-cleanup', () => {
	it('refuses a caller without the secret, and deletes nothing', async () => {
		await makeCampaign('run-1', { age: 3 * HOUR });
		const before = await snapshot();

		expect((await pass({})).status).toBe(401);
		expect((await pass({ [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect(await snapshot()).toEqual(before);
	});

	it('deletes a settled test campaign that is old enough, with everything of its own and nothing else', async () => {
		await fixedCampaign(30 * 24 * HOUR, { ownsPublicPicture: true });
		const before = await snapshot();
		await makeCampaign('run-1', { age: 3 * HOUR });
		// It really did have a row in every table. (All but `donations`: a campaign with a
		// donation is not settled. The 24-hour test below deletes one that has.)
		for (const [name, rows] of Object.entries(await snapshot())) {
			if (name === 'donations') continue;
			expect(rows.length, name).toBeGreaterThan(before[name]!.length);
		}

		const { status, report } = await pass();

		expect(status).toBe(200);
		expect(report.deleted).toEqual([
			{
				campaign_id: 'run-1',
				money_not_finished: false,
				deposits_not_refunded: 0,
				donations_not_undone: 0,
				// Its own kept-from-donors picture: the row is gone, the bytes are not ours to remove.
				evidence_files_left_in_store: 1,
				evidence_files_handed_over: 0
			}
		]);
		expect(report.left).toEqual([]);
		// Every table is exactly as it was before the campaign existed: the real campaign, the
		// fixed test campaign and the shared picture's row are untouched.
		expect(await snapshot()).toEqual(before);
		expect(await rowsMentioning('run-1')).toBe(0);
	});

	it('never deletes the fixed test campaign, at any age, settled or not', async () => {
		await fixedCampaign(400 * 24 * HOUR);
		const before = await snapshot();

		const { report } = await pass();

		expect(report.deleted).toEqual([]);
		expect(report.left).toEqual([]);
		expect(await snapshot()).toEqual(before);
		expect(await exists(E2E_CAMPAIGN_ID)).toBe(true);
	});

	it('never deletes a real campaign', async () => {
		// The seeded fixture campaign is a real one. Make it old, to be sure age is not what saves it.
		await test.db
			.update(campaigns)
			.set({ createdAt: ago(400 * 24 * HOUR) })
			.where(eq(campaigns.id, REAL_CAMPAIGN));
		const before = await snapshot();

		const { report } = await pass();

		expect(report).toMatchObject({ deleted: [], left: [], needs_a_person: false });
		expect(await snapshot()).toEqual(before);
		expect(logged).toBe('');
	});

	it('never deletes a campaign whose creator only looks like a test person', async () => {
		const lookAlikes = {
			'longer-domain': `e2e-creator@not${E2E_TEST_EMAIL_DOMAIN}`,
			subdomain: `e2e-creator@mail.${E2E_TEST_EMAIL_DOMAIN}`,
			'domain-goes-on': `e2e-creator@${E2E_TEST_EMAIL_DOMAIN}.example.com`,
			'domain-before-at': `${E2E_TEST_EMAIL_DOMAIN}@example.com`,
			'two-ats': `someone@example.com@${E2E_TEST_EMAIL_DOMAIN}`
		};
		for (const [id, creatorEmail] of Object.entries(lookAlikes)) {
			await makeCampaign(id, { age: 400 * 24 * HOUR, creatorEmail });
		}
		const before = await snapshot();

		const { report } = await pass();

		expect(report.deleted).toEqual([]);
		// Only the one the database's shortcut lets through is even considered, and the rule
		// in code refuses it.
		expect(leftReasons(report)).toEqual({ 'two-ats': 'creator_not_a_test_person' });
		expect(report.needs_a_person).toBe(true);
		expect(await snapshot()).toEqual(before);
	});

	it('never deletes a campaign with somebody on it who is not a test person', async () => {
		await makeCampaign('mixed', { age: 400 * 24 * HOUR, confirmerEmail: 'rosa@example.com' });
		await makeCampaign('mixed-look-alike', {
			age: 400 * 24 * HOUR,
			contractorEmail: `rosa@mail.${E2E_TEST_EMAIL_DOMAIN}`
		});
		const before = await snapshot();

		const { report } = await pass();

		expect(report.deleted).toEqual([]);
		expect(leftReasons(report)).toEqual({
			mixed: 'has_other_people',
			'mixed-look-alike': 'has_other_people'
		});
		expect(report.needs_a_person).toBe(true);
		expect(await snapshot()).toEqual(before);
	});

	it('leaves a young test campaign until it is two hours old', async () => {
		await makeCampaign('young', { age: MIN_AGE_MS - 60_000 });
		await makeCampaign('just-old-enough', { age: MIN_AGE_MS + 60_000 });

		const { report } = await pass();

		expect(report.deleted.map((line) => line.campaign_id)).toEqual(['just-old-enough']);
		expect(await exists('young')).toBe(true);
		expect(await rowsMentioning('young-')).toBeGreaterThan(10);
	});

	it('leaves a campaign whose money is not finished, and says why', async () => {
		await makeCampaign('unrefunded', { age: 3 * HOUR, refunded: false });
		await makeCampaign('started', { age: 3 * HOUR, refundStatus: 'started' });
		await makeCampaign('unknown', { age: 3 * HOUR, refundStatus: 'unknown' });
		await makeCampaign('donated', { age: 3 * HOUR, donation: true });
		const before = await snapshot();

		const { report } = await pass();

		expect(report.deleted).toEqual([]);
		expect(leftReasons(report)).toEqual({
			unrefunded: 'deposit_not_refunded',
			started: 'refund_in_progress',
			unknown: 'refund_outcome_unknown',
			donated: 'donation_not_undone'
		});
		// These clear by themselves, or at 24 hours: nobody is asked to look.
		expect(report.needs_a_person).toBe(false);
		expect(await snapshot()).toEqual(before);
		expect(logged).toBe(
			'Test-campaign cleanup: 0 deleted, 0 of them with money not finished (0 deposits not refunded, 0 donations not undone), 4 left (deposit_not_refunded 1, donation_not_undone 1, refund_in_progress 1, refund_outcome_unknown 1), evidence files left in the store: 0, a person needs to look: no.\n'
		);
	});

	it('deletes a campaign whose money is not finished once it is 24 hours old, and counts what was left', async () => {
		const before = await snapshot();
		await makeCampaign('donated', { age: FORCE_AGE_MS + 2 * 60_000, donation: true });
		await makeCampaign('unrefunded', { age: FORCE_AGE_MS + 60_000, refunded: false });
		expect(await rowsMentioning('donated-don')).toBe(1);
		await makeCampaign('almost', { age: FORCE_AGE_MS - 60_000, refunded: false });

		const { report } = await pass();

		expect(report.deleted).toEqual([
			expect.objectContaining({
				campaign_id: 'donated',
				money_not_finished: true,
				deposits_not_refunded: 0,
				donations_not_undone: 1
			}),
			expect.objectContaining({
				campaign_id: 'unrefunded',
				money_not_finished: true,
				deposits_not_refunded: 3,
				donations_not_undone: 0
			})
		]);
		expect(leftReasons(report)).toEqual({ almost: 'deposit_not_refunded' });
		expect(await exists('almost')).toBe(true);
		expect(await rowsMentioning('unrefunded')).toBe(0);
		expect(await rowsMentioning('donated')).toBe(0);
		expect(logged).toContain(
			'2 deleted, 2 of them with money not finished (3 deposits not refunded, 1 donations not undone), 1 left (deposit_not_refunded 1)'
		);

		// And with the last one gone too, the database is as it was.
		await test.db
			.update(campaigns)
			.set({ createdAt: ago(FORCE_AGE_MS) })
			.where(eq(campaigns.id, 'almost'));
		await pass();
		expect(await snapshot()).toEqual(before);
	});

	it('keeps the record of a shared picture while another campaign still names it', async () => {
		// The first run's contractor uploaded the public picture first, so its record is theirs.
		// The fixed campaign and a later run name the same picture.
		await fixedCampaign(30 * 24 * HOUR);
		await makeCampaign('run-1', { age: 5 * HOUR, ownsPublicPicture: true });
		await makeCampaign('run-2', { age: MIN_AGE_MS - 60_000 });
		const record = async () =>
			(
				await test.db.select().from(evidenceFiles).where(eq(evidenceFiles.sha256, PUBLIC_PICTURE))
			)[0];
		const original = (await record())!;

		const { report } = await pass();

		expect(report.deleted).toEqual([
			expect.objectContaining({
				campaign_id: 'run-1',
				// Only its own picture is left without a record. The shared one keeps its record.
				evidence_files_left_in_store: 1,
				evidence_files_handed_over: 1
			})
		]);
		// The record is unchanged but for whose it is: the same test person, on the campaign
		// that has named the picture longest.
		expect(await record()).toEqual({
			...original,
			uploadedByPartyId: `${E2E_CAMPAIGN_ID}-contractor`
		});
		expect(await rowsMentioning('run-1')).toBe(0);
	});

	it('deletes the record of a shared picture only with the last campaign that names it', async () => {
		await makeCampaign('run-1', { age: 5 * HOUR, ownsPublicPicture: true });
		await makeCampaign('run-2', { age: 4 * HOUR });
		const records = async () =>
			(await test.db.select().from(evidenceFiles).where(eq(evidenceFiles.sha256, PUBLIC_PICTURE)))
				.length;

		// One at a time, oldest first.
		await test.db
			.update(campaigns)
			.set({ createdAt: ago(HOUR) })
			.where(eq(campaigns.id, 'run-2'));
		expect((await pass()).report.deleted.map((line) => line.campaign_id)).toEqual(['run-1']);
		expect(await records()).toBe(1);

		await test.db
			.update(campaigns)
			.set({ createdAt: ago(4 * HOUR) })
			.where(eq(campaigns.id, 'run-2'));
		const { report } = await pass();
		expect(report.deleted).toEqual([
			expect.objectContaining({
				campaign_id: 'run-2',
				// Its own picture, and now the shared one: nothing names either any more.
				evidence_files_left_in_store: 2,
				evidence_files_handed_over: 0
			})
		]);
		expect(await records()).toBe(0);
	});

	it('leaves a campaign whole when a file of its people is named by somebody else elsewhere', async () => {
		await makeCampaign('run-1', { age: 5 * HOUR, ownsPublicPicture: true });
		// A real person's entry on the real campaign names the same bytes.
		const realEntry = fixtures.entries[0]!;
		await test.db
			.update(entries)
			.set({
				inputs: {
					...realEntry.inputs,
					photos: [
						{
							url: `https://app.tejido.example/evidence/${PUBLIC_PICTURE}.png`,
							sha256: PUBLIC_PICTURE,
							caption: 'The same bytes'
						}
					]
				}
			})
			.where(eq(entries.id, realEntry.id));
		const before = await snapshot();

		const { report } = await pass();

		expect(report.deleted).toEqual([]);
		expect(leftReasons(report)).toEqual({ 'run-1': 'evidence_named_by_someone_else' });
		expect(report.needs_a_person).toBe(true);
		expect(await snapshot()).toEqual(before);
	});

	it('leaves a campaign whole when the database refuses any part of the deletion', async () => {
		await makeCampaign('run-1', { age: 5 * HOUR });
		// Something this code does not expect points at the campaign: an entry of the real
		// campaign filed by one of its people.
		await test.db
			.update(entries)
			.set({ partyId: 'run-1-confirmer' })
			.where(eq(entries.id, fixtures.entries[0]!.id));
		const before = await snapshot();

		const { status, report } = await pass();

		expect(status).toBe(200);
		expect(report.deleted).toEqual([]);
		expect(leftReasons(report)).toEqual({ 'run-1': 'could_not_delete' });
		expect(report.needs_a_person).toBe(true);
		// All or nothing: not one row of it is gone.
		expect(await snapshot()).toEqual(before);
	});

	it('deletes at most five in a pass, oldest first, and a later pass takes the rest', async () => {
		const before = await snapshot();
		const ids = Array.from({ length: PASS_LIMIT + 2 }, (_, index) => `run-${index + 1}`);
		for (const [index, id] of ids.entries()) {
			await makeCampaign(id, { age: (20 - index) * HOUR });
		}

		const first = await pass();

		expect(first.report.deleted.map((line) => line.campaign_id)).toEqual(ids.slice(0, PASS_LIMIT));
		expect(leftReasons(first.report)).toEqual({
			'run-6': 'pass_limit_reached',
			'run-7': 'pass_limit_reached'
		});
		expect(first.report.needs_a_person).toBe(false);

		const second = await pass();
		expect(second.report.deleted.map((line) => line.campaign_id)).toEqual(ids.slice(PASS_LIMIT));
		expect(await snapshot()).toEqual(before);
	});

	it('does not let campaigns that are waiting use up the five', async () => {
		for (let index = 1; index <= PASS_LIMIT + 1; index++) {
			await makeCampaign(`waiting-${index}`, { age: 20 * HOUR, refunded: false });
		}
		await makeCampaign('settled', { age: 3 * HOUR });

		const { report } = await pass();

		expect(report.deleted.map((line) => line.campaign_id)).toEqual(['settled']);
		expect(report.left).toHaveLength(PASS_LIMIT + 1);
	});

	it('finds nothing to do on a second pass, and says nothing', async () => {
		await makeCampaign('run-1', { age: 3 * HOUR });
		await pass();
		const after = await snapshot();
		logged = '';

		const { report } = await pass();

		expect(report).toEqual({
			deleted: [],
			left: [],
			needs_a_person: false,
			message: 'Nothing was deleted.'
		});
		expect(await snapshot()).toEqual(after);
		expect(logged).toBe('');
	});

	it('writes one log line of counts and reason names, with no email, id or title in it', async () => {
		await makeCampaign('run-1', { age: 3 * HOUR });
		await makeCampaign('mixed', { age: 3 * HOUR, confirmerEmail: 'rosa@example.com' });

		await pass();

		expect(logged).toBe(
			'Test-campaign cleanup: 1 deleted, 0 of them with money not finished (0 deposits not refunded, 0 donations not undone), 1 left (has_other_people 1), evidence files left in the store: 1, a person needs to look: YES.\n'
		);
		for (const secret of ['run-1', 'mixed', '@', 'rosa', 'Automatic test', E2E_TEST_EMAIL_DOMAIN]) {
			expect(logged).not.toContain(secret);
		}
	});
});
