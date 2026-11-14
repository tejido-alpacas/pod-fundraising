// Calls the timeline's own load against a real, migrated, seeded database. Nothing here
// reaches the network.
import { isHttpError } from '@sveltejs/kit';
import type { Entry, LogWorkEntry, MilestoneHitEntry } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, deposits, entries, milestones, parties } from '@tejido/db';
import { eq, inArray } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server.ts';

const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

// The evidence store is the App, which is also where the sign-in callback is.
const APP = 'http://localhost:5174';

/** A file as the evidence upload would return it: stored under its own SHA-256. */
function evidence(extension: 'jpg' | 'png' | 'webp' | 'pdf', fill: string, caption?: string) {
	const sha256 = fill.repeat(64);
	return { url: `${APP}/evidence/${sha256}.${extension}`, sha256, ...(caption ? { caption } : {}) };
}

let test: TestDatabase;

// The day after the newest seeded entry. "Overdue" is counted from the day the page is built.
const TODAY = '2026-11-14';

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
	test = await createTestDatabase({ seed: true });
});
afterEach(async () => {
	vi.useRealTimers();
	await test.destroy();
});

async function timeline(campaignId: string = CAMPAIGN, query = '') {
	const event = {
		params: { campaignId },
		locals: { ctx: { db: test.db, config: { OIDC_REDIRECT_URI: `${APP}/auth/callback` } } },
		url: new URL(`http://localhost/campaigns/${campaignId}${query}`)
	};
	return load(event as unknown as Parameters<typeof load>[0]);
}

type WorkLogOverrides = Partial<Omit<LogWorkEntry, 'inputs'>> & {
	inputs?: Partial<LogWorkEntry['inputs']>;
};

/** Saves a work log by the contractor on the walls milestone, with whatever differs. */
async function addWorkLog(id: string, overrides: WorkLogOverrides = {}) {
	const filedAt = overrides.filedAt ?? '2026-11-14T08:00:00.000Z';
	const entry: Entry = {
		id,
		campaignId: CAMPAIGN,
		milestoneId: 'm2-walls',
		partyId: contractor.id,
		item: 'log_work',
		status: 'filed',
		statusReason: null,
		payingWallet: null,
		twistId: null,
		stampedAt: null,
		updatedAt: filedAt,
		...overrides,
		filedAt,
		inputs: {
			reporter_code: contractor.reporterCode,
			milestone_id: overrides.milestoneId ?? 'm2-walls',
			summary: `Summary of ${id}.`,
			...overrides.inputs
		}
	};
	await test.db.insert(entries).values(entry);
}

async function addClaim(id: string, values: Pick<MilestoneHitEntry, 'milestoneId' | 'inputs'>) {
	const filedAt = '2026-11-14T09:00:00.000Z';
	const entry: Entry = {
		id,
		campaignId: CAMPAIGN,
		partyId: supplier.id,
		item: 'milestone_hit',
		status: 'incomplete',
		statusReason: 'Something is missing.',
		payingWallet: null,
		twistId: null,
		filedAt,
		stampedAt: null,
		updatedAt: filedAt,
		...values
	};
	await test.db.insert(entries).values(entry);
}

const entryOf = (data: Awaited<ReturnType<typeof timeline>>, id: string) => {
	const entry = data.entries.find((candidate) => candidate.id === id);
	if (!entry) throw new Error(`no entry ${id} on the timeline`);
	return entry;
};

describe('the donor timeline', () => {
	it('answers 404 for a campaign that does not exist', async () => {
		const failure = await timeline('no-such-campaign').catch((thrown: unknown) => thrown);
		expect(isHttpError(failure, 404)).toBe(true);
	});

	it('shows the campaign header and a line per milestone, in order', async () => {
		const data = await timeline();
		expect(data.campaign).toEqual({
			id: CAMPAIGN,
			title: fixtures.campaign.title,
			summary: fixtures.campaign.summary,
			beneficiary: fixtures.campaign.beneficiary,
			creatorName: fixtures.campaign.creatorName,
			status: 'reporting',
			createdAt: fixtures.campaign.createdAt
		});
		expect(data.today).toBe(TODAY);
		expect(data.milestones).toEqual([
			{
				id: 'm1-foundation',
				position: 1,
				title: 'Foundation and floor slab',
				state: 'confirmed_independent',
				status: 'confirmed',
				overdueDays: 0,
				// The head teacher benefits from the library: a stakeholder confirmation.
				strength: 'stakeholder',
				dueDate: '2026-10-30',
				confirmedAt: '2026-10-30T09:41:07.000Z',
				ownerName: contractor.name,
				confirmerName: headTeacher.name,
				reportedPercent: null
			},
			{
				id: 'm2-walls',
				position: 2,
				title: 'Walls up to roof height',
				state: 'open',
				// Work logs have been filed on it, and nobody has claimed it.
				status: 'in-progress',
				overdueDays: 0,
				strength: null,
				dueDate: '2026-11-27',
				confirmedAt: null,
				ownerName: contractor.name,
				confirmerName: headTeacher.name,
				// The newest work log's own figure, not one Tejido worked out.
				reportedPercent: 35
			},
			{
				id: 'm3-books-delivered',
				position: 3,
				title: 'Books delivered',
				state: 'claimed',
				status: 'claimed',
				overdueDays: 0,
				strength: null,
				dueDate: '2026-11-20',
				confirmedAt: null,
				ownerName: supplier.name,
				confirmerName: headTeacher.name,
				reportedPercent: null
			}
		]);
	});

	it('counts delivery in milestones, and sends no percentage and nothing about funding', async () => {
		const data = await timeline();
		expect(data.delivery).toEqual({ confirmed: 1, total: 3 });
		// Funding is not modelled: no raised amount, goal or contribution count is sent.
		expect(Object.keys(data).sort()).toEqual(
			[
				'campaign',
				'delivery',
				'entries',
				'flagged',
				'milestones',
				'nextShow',
				'parties',
				'today',
				'total'
			].sort()
		);
	});

	it('marks a milestone overdue from its due date, beside its status and never once confirmed', async () => {
		vi.setSystemTime(new Date('2026-11-28T00:30:00.000Z'));
		const data = await timeline();
		expect(
			data.milestones.map((milestone) => [milestone.id, milestone.status, milestone.overdueDays])
		).toEqual([
			// Due 30 Oct and confirmed: never overdue.
			['m1-foundation', 'confirmed', 0],
			['m2-walls', 'in-progress', 1],
			// Claimed is not confirmed: it is still late.
			['m3-books-delivered', 'claimed', 8]
		]);
	});

	it('calls a milestone not started until something is reported on it', async () => {
		// Each entry has a deposit, which goes first.
		await test.db
			.delete(deposits)
			.where(inArray(deposits.entryId, ['ent-m2-log-1', 'ent-m2-log-2']));
		await test.db.delete(entries).where(eq(entries.milestoneId, 'm2-walls'));
		const data = await timeline();
		expect(data.milestones[1]).toMatchObject({ status: 'not-started', reportedPercent: null });
	});

	it('says who is involved, with each relationship and never an email address', async () => {
		const data = await timeline();
		expect(data.parties).toEqual([
			{
				id: contractor.id,
				name: contractor.name,
				title: contractor.title,
				role: 'third_party',
				relationship: 'participant',
				relationshipRecorded: true,
				relationshipReason: null
			},
			{
				id: supplier.id,
				name: supplier.name,
				title: supplier.title,
				role: 'third_party',
				relationship: 'participant',
				relationshipRecorded: true,
				relationshipReason: null
			},
			{
				id: headTeacher.id,
				name: headTeacher.name,
				title: headTeacher.title,
				role: 'confirmer',
				relationship: 'stakeholder',
				relationshipRecorded: true,
				relationshipReason: 'Head teacher of the school whose library is being rebuilt.'
			}
		]);
	});

	it('shows an unrecorded relationship as stakeholder, never independent, and says it is unrecorded', async () => {
		await test.db
			.update(parties)
			.set({ relationship: null, relationshipReason: null })
			.where(eq(parties.id, headTeacher.id));
		const data = await timeline();
		expect(data.parties[2]).toMatchObject({
			relationship: 'stakeholder',
			relationshipRecorded: false
		});
		expect(entryOf(data, 'ent-m1-confirm').strength).toBe('stakeholder');
		expect(data.milestones[0]?.strength).toBe('stakeholder');
	});

	it('gives a confirmation its strength and each entry its milestone badge', async () => {
		const data = await timeline();
		expect(
			data.entries.map((entry) => [
				entry.id,
				entry.milestonePosition,
				entry.milestoneBadge,
				entry.strength
			])
		).toEqual([
			['ent-m2-log-2', 2, null, null],
			// An incomplete claim still moved its milestone to claimed.
			['ent-m3-delivery', 3, 'claimed', null],
			['ent-m2-log-1', 2, null, null],
			['ent-m1-confirm', 1, 'confirmed', 'stakeholder'],
			['ent-m1-claim', 1, 'claimed', null]
		]);
	});

	it('gives each entry its deposit as held, refunded or refund outstanding', async () => {
		const data = await timeline();
		const held = { state: 'held', label: 'Deposit held', outstandingMeaning: null };
		const refunded = { state: 'refunded', label: 'Deposit refunded', outstandingMeaning: null };
		expect(data.entries.map((entry) => [entry.id, entry.deposit])).toEqual([
			['ent-m2-log-2', { amount: '0.10', ...held }],
			['ent-m3-delivery', { amount: '1.00', ...held }],
			['ent-m2-log-1', { amount: '0.10', ...held }],
			['ent-m1-confirm', { amount: '1.00', ...refunded }],
			['ent-m1-claim', { amount: '1.00', ...refunded }]
		]);
	});

	it('says a refund is outstanding, and why, when the milestone is confirmed and the deposit is not back', async () => {
		await test.db
			.update(deposits)
			.set({ refundedAt: null })
			.where(eq(deposits.entryId, 'ent-m1-claim'));
		const deposit = entryOf(await timeline(), 'ent-m1-claim').deposit;
		expect(deposit).toMatchObject({
			amount: '1.00',
			state: 'refund_outstanding',
			label: 'Refund outstanding'
		});
		// The reason is a sentence a donor can read, and names no wallet address.
		expect(deposit?.outstandingMeaning).toEqual(expect.stringContaining('deposit'));
	});

	it('shows no deposit for an entry that has none on record', async () => {
		await addWorkLog('no-deposit');
		expect(entryOf(await timeline(), 'no-deposit').deposit).toBeNull();
	});

	it('lists every entry newest first, each with its kind, milestone, filer and proof link', async () => {
		const data = await timeline();
		expect(data.total).toBe(5);
		expect(data.nextShow).toBeNull();
		expect(
			data.entries.map((entry) => [entry.id, entry.heading, entry.claim, entry.status])
		).toEqual([
			['ent-m2-log-2', 'Work log', null, 'filed'],
			['ent-m3-delivery', 'Milestone claim', 'delivered', 'incomplete'],
			['ent-m2-log-1', 'Work log', null, 'flagged'],
			['ent-m1-confirm', 'Confirmation', null, 'verified'],
			['ent-m1-claim', 'Milestone claim', 'completed', 'verified']
		]);

		const confirmation = entryOf(data, 'ent-m1-confirm');
		expect(confirmation.kind).toBe('confirmation');
		expect(confirmation.milestoneTitle).toBe('Foundation and floor slab');
		expect(confirmation.filer).toEqual({
			name: headTeacher.name,
			title: headTeacher.title,
			role: 'confirmer',
			relationship: 'stakeholder',
			relationshipReason: 'Head teacher of the school whose library is being rebuilt.'
		});
		expect(confirmation.filedAt).toBe('2026-10-30T09:41:07.000Z');
		expect(confirmation.proofPath).toBe(`/campaigns/${CAMPAIGN}/entries/ent-m1-confirm`);
	});

	it('shows what a work log reported: status, percent complete, period and location', async () => {
		const log = entryOf(await timeline(), 'ent-m2-log-2');
		expect(log).toMatchObject({
			kind: 'work_log',
			workStatus: 'delayed',
			percentComplete: 35,
			period: 'Week of 9 November',
			location: 'Mangrove Bay Primary School, library wing',
			quantity: null,
			unit: null,
			amountSpent: null
		});
		expect(log.summary).toContain('Rain stopped block laying');
	});

	it('shows what a claim reported: quantity and unit, and amount spent', async () => {
		await addClaim('ent-extra-delivery', {
			milestoneId: 'm3-books-delivered',
			inputs: {
				reporter_code: supplier.reporterCode,
				milestone_id: 'm3-books-delivered',
				claim: 'delivered',
				summary: 'Second shipment.',
				quantity: 600,
				unit: 'books',
				amount_spent: 1840.5
			}
		});
		expect(entryOf(await timeline(), 'ent-extra-delivery')).toMatchObject({
			kind: 'claim',
			claim: 'delivered',
			quantity: 600,
			unit: 'books',
			amountSpent: 1840.5,
			workStatus: null,
			percentComplete: null,
			period: null
		});
	});

	it('gives the stored reason on an incomplete and on a flagged entry, and none otherwise', async () => {
		const data = await timeline();
		expect(entryOf(data, 'ent-m3-delivery').statusReason).toBe(
			'A delivery needs a quantity and a unit.'
		);
		expect(entryOf(data, 'ent-m2-log-1').statusReason).toMatch(/not the one registered/);
		expect(entryOf(data, 'ent-m2-log-2').statusReason).toBeNull();
		expect(entryOf(data, 'ent-m1-claim').statusReason).toBeNull();
	});

	it('names flagged entries above the feed', async () => {
		const data = await timeline();
		expect(data.flagged.count).toBe(1);
		expect(data.flagged.named).toEqual([
			{
				id: 'ent-m2-log-1',
				heading: 'Work log',
				milestoneTitle: 'Walls up to roof height',
				filedAt: '2026-11-06T16:20:11.000Z',
				proofPath: `/campaigns/${CAMPAIGN}/entries/ent-m2-log-1`
			}
		]);
	});

	it('sends the browser no reporter code, email, wallet or stored input', async () => {
		const sent = JSON.stringify(await timeline());
		for (const party of fixtures.parties) {
			expect(sent).not.toContain(party.reporterCode);
			expect(sent).not.toContain(party.email);
			expect(sent).not.toContain(party.primaryWalletHostname);
			expect(sent).not.toContain(party.agentWalletHostname);
		}
		expect(sent).not.toContain(fixtures.campaign.creatorEmail);
		expect(sent).not.toContain('reporter_code');
		expect(sent).not.toContain('reporterCode');
		expect(sent).not.toContain('rc_');
		expect(sent).not.toContain('@');
		expect(sent).not.toContain('inputs');
		// Nor a session, a token, a commodity id, or a wallet's address or field. (The word
		// "wallet" itself is allowed: the reason an entry is flagged says it in plain words.)
		expect(sent).not.toMatch(/session|token|commodity|Wallet|wallets\./);
		expect(sent).not.toContain(String(fixtures.campaign.logWorkCommodityId));
	});
});

describe('evidence on the timeline', () => {
	it('shows none of the seeded files, which are not in our evidence store', async () => {
		const data = await timeline();
		expect(entryOf(data, 'ent-m1-claim').evidence).toEqual({
			photos: [],
			documents: [],
			leftOut: 2
		});
		expect(entryOf(data, 'ent-m1-confirm').evidence).toEqual({
			photos: [],
			documents: [],
			leftOut: 0
		});
		expect(JSON.stringify(data)).not.toContain('evidence.tejido.example');
	});

	it('shows pictures as photos and PDFs as documents, and leaves out what fails the check', async () => {
		const photo = evidence('jpg', 'a', 'North wall');
		const document = evidence('pdf', 'b');
		await addWorkLog('ent-evidence', {
			inputs: {
				photos: [
					photo,
					document,
					// Not in our store at all.
					{
						url: `https://elsewhere.example/evidence/${'c'.repeat(64)}.jpg`,
						sha256: 'c'.repeat(64)
					},
					// In our store, but the hash given is not that file's.
					{ url: evidence('png', 'd').url, sha256: 'e'.repeat(64) },
					// Our origin, but not a file the evidence store serves.
					{ url: `${APP}/auth/callback?next=x.jpg`, sha256: 'f'.repeat(64) }
				]
			}
		});

		const data = await timeline();
		expect(entryOf(data, 'ent-evidence').evidence).toEqual({
			photos: [{ url: photo.url, sha256: photo.sha256, caption: 'North wall' }],
			documents: [{ url: document.url, sha256: document.sha256, caption: null }],
			leftOut: 3
		});
		const sent = JSON.stringify(data);
		expect(sent).not.toContain('elsewhere.example');
		expect(sent).not.toContain('auth/callback');
	});

	it('shows no picture on a documents-only milestone, only its documents', async () => {
		await test.db.insert(milestones).values({
			campaignId: CAMPAIGN,
			id: 'm4-school-fees',
			position: 4,
			title: 'School fees paid',
			description: '',
			kind: 'funds_handover',
			ownerPartyId: supplier.id,
			confirmerPartyId: headTeacher.id,
			dueDate: '2026-12-18',
			state: 'claimed',
			confirmedAt: null
		});
		const receipt = evidence('pdf', 'a', 'Fee receipt');
		await addClaim('ent-fees', {
			milestoneId: 'm4-school-fees',
			inputs: {
				reporter_code: supplier.reporterCode,
				milestone_id: 'm4-school-fees',
				claim: 'funds_spent',
				summary: 'Term fees paid.',
				amount_spent: 250,
				photos: [evidence('jpg', 'b', 'A pupil at the school gate'), receipt]
			}
		});

		const data = await timeline();
		expect(entryOf(data, 'ent-fees').evidence).toEqual({
			photos: [],
			documents: [{ url: receipt.url, sha256: receipt.sha256, caption: 'Fee receipt' }],
			leftOut: 1
		});
		expect(JSON.stringify(data)).not.toContain('A pupil at the school gate');
	});
});

describe('a campaign with nothing reported yet', () => {
	it('has an empty timeline and no flags', async () => {
		await test.db
			.insert(campaigns)
			.values({ ...fixtures.campaign, id: 'village-well', title: 'A well for the village' });

		const data = await timeline('village-well');
		expect(data.campaign.title).toBe('A well for the village');
		expect(data.milestones).toEqual([]);
		expect(data.delivery).toEqual({ confirmed: 0, total: 0 });
		expect(data.parties).toEqual([]);
		expect(data.entries).toEqual([]);
		expect(data.total).toBe(0);
		expect(data.nextShow).toBeNull();
		expect(data.flagged).toEqual({ count: 0, named: [] });
	});
});

describe('a long timeline', () => {
	// Thirty entries in all: the five seeded ones are the oldest.
	beforeEach(async () => {
		for (let n = 1; n <= 25; n += 1) {
			const day = String(n).padStart(2, '0');
			await addWorkLog(`ent-long-${day}`, { filedAt: `2026-12-${day}T12:00:00.000Z` });
		}
	});

	it('shows the newest twenty and offers the rest', async () => {
		const data = await timeline();
		expect(data.total).toBe(30);
		expect(data.entries).toHaveLength(20);
		expect(data.entries[0]?.id).toBe('ent-long-25');
		expect(data.entries[19]?.id).toBe('ent-long-06');
		expect(data.nextShow).toBe(30);
	});

	it('shows more when asked, and stops offering once everything is shown', async () => {
		const data = await timeline(CAMPAIGN, '?show=30');
		expect(data.entries).toHaveLength(30);
		expect(data.entries[29]?.id).toBe('ent-m1-claim');
		expect(data.nextShow).toBeNull();

		expect((await timeline(CAMPAIGN, '?show=5000')).entries).toHaveLength(30);
	});

	it.each(['?show=abc', '?show=-40', '?show=0', '?show=3', '?show=1e9', '?show='])(
		'falls back to the first twenty for %s',
		async (query) => {
			const data = await timeline(CAMPAIGN, query);
			expect(data.entries).toHaveLength(20);
			expect(data.nextShow).toBe(30);
		}
	);

	it('still counts a flagged entry that is further down than the entries shown', async () => {
		const data = await timeline();
		expect(data.entries.some((entry) => entry.status === 'flagged')).toBe(false);
		expect(data.flagged.count).toBe(1);
		expect(data.flagged.named[0]?.id).toBe('ent-m2-log-1');
	});
});
