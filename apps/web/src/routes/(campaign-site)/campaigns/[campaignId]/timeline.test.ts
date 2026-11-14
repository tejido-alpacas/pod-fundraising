// Calls the timeline's own load against a real, migrated, seeded database. Nothing here
// reaches the network.
import { isHttpError } from '@sveltejs/kit';
import type { Entry, LogWorkEntry, MilestoneHitEntry } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, entries, evidenceFiles, milestones } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test.destroy());

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
			status: 'reporting'
		});
		expect(data.milestones).toEqual([
			{
				id: 'm1-foundation',
				title: 'Foundation and floor slab',
				state: 'confirmed_independent',
				// The head teacher benefits from the library: a stakeholder confirmation.
				strength: 'stakeholder',
				dueDate: '2026-10-30'
			},
			{
				id: 'm2-walls',
				title: 'Walls up to roof height',
				state: 'open',
				strength: null,
				dueDate: '2026-11-27'
			},
			{
				id: 'm3-books-delivered',
				title: 'Books delivered',
				state: 'claimed',
				strength: null,
				dueDate: '2026-11-20'
			}
		]);
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
	});
});

describe('evidence on the timeline', () => {
	it('shows none of the seeded files, which are not in our evidence store', async () => {
		const data = await timeline();
		expect(entryOf(data, 'ent-m1-claim').evidence).toMatchObject({
			photos: [],
			documents: [],
			notPublic: [],
			leftOut: 2
		});
		expect(entryOf(data, 'ent-m1-confirm').evidence).toEqual({
			photos: [],
			documents: [],
			notPublic: [],
			leftOut: 0,
			files: []
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
		const sorted = entryOf(data, 'ent-evidence').evidence;
		expect(sorted).toMatchObject({
			photos: [{ url: photo.url, sha256: photo.sha256, caption: 'North wall' }],
			documents: [{ url: document.url, sha256: document.sha256, caption: null }],
			notPublic: [],
			leftOut: 3
		});
		// Every file keeps its place, with its state and, when left out, the reason.
		expect(sorted.files.map((file) => [file.state, 'reason' in file ? file.reason : null])).toEqual(
			[
				['shown', null],
				['shown', null],
				['left_out', 'not_in_our_store'],
				['left_out', 'hash_mismatch'],
				['left_out', 'not_in_our_store']
			]
		);
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
		expect(entryOf(data, 'ent-fees').evidence).toMatchObject({
			photos: [],
			documents: [{ url: receipt.url, sha256: receipt.sha256, caption: 'Fee receipt' }],
			notPublic: [],
			leftOut: 1
		});
		expect(JSON.stringify(data)).not.toContain('A pupil at the school gate');
	});

	it('tells donors what a not-public file is and why, and never sends its address', async () => {
		const photo = evidence('jpg', 'a', 'North wall');
		const classList = evidence('pdf', 'b', 'Class list for form 3, with every name');
		await addWorkLog('ent-private', { inputs: { photos: [photo, classList] } });
		await test.db.insert(evidenceFiles).values({
			sha256: classList.sha256,
			uploadedByPartyId: contractor.id,
			visibility: 'not_public',
			notPublicKind: 'Class list',
			notPublicReason: 'It has pupils’ names on it.',
			createdAt: '2026-11-14T08:00:00.000Z',
			updatedAt: '2026-11-14T08:00:00.000Z'
		});

		const data = await timeline();
		expect(entryOf(data, 'ent-private').evidence).toEqual({
			photos: [{ url: photo.url, sha256: photo.sha256, caption: 'North wall' }],
			documents: [],
			notPublic: [
				{ kind: 'Class list', reason: 'It has pupils’ names on it.', sha256: classList.sha256 }
			],
			leftOut: 0,
			files: [
				{ state: 'shown', kind: 'photo', ...photo, caption: 'North wall' },
				{
					state: 'not_public',
					kind: 'Class list',
					reason: 'It has pupils’ names on it.',
					sha256: classList.sha256
				}
			]
		});
		// Nothing a donor's browser receives can fetch the file: not its address, not its
		// file name, and not the caption filed with it.
		const sent = JSON.stringify(data);
		expect(sent).not.toContain(classList.url);
		expect(sent).not.toContain(`${classList.sha256}.pdf`);
		expect(sent).not.toContain('with every name');
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
