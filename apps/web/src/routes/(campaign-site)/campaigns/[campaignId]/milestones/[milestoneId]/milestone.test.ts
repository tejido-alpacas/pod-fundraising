// Calls the milestone page's own load against a real, migrated, seeded database. Nothing here
// reaches the network.
import { isHttpError } from '@sveltejs/kit';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaigns,
	deposits,
	entries,
	evidenceFiles,
	milestones,
	setPartyRelationship
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server.ts';

const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;
const headTeacher = fixtures.parties[2]!;

// The evidence store is the App, which is also where the sign-in callback is.
const APP = 'http://localhost:5174';

/** A file as the evidence upload would return it: stored under its own SHA-256. */
function stored(extension: 'jpg' | 'pdf', fill: string, caption?: string) {
	const sha256 = fill.repeat(64);
	return { url: `${APP}/evidence/${sha256}.${extension}`, sha256, ...(caption ? { caption } : {}) };
}

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	// The fixtures' due dates are 30 October, 20 November and 27 November 2026.
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T12:00:00.000Z') });
});
afterEach(async () => {
	vi.useRealTimers();
	await test.destroy();
});

async function page(milestoneId: string, campaignId: string = CAMPAIGN) {
	const config = { OIDC_REDIRECT_URI: `${APP}/auth/callback` };
	const event = { params: { campaignId, milestoneId }, locals: { ctx: { db: test.db, config } } };
	const data = await load(event as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('the load returned nothing');
	return data;
}

async function notFound(milestoneId: string, campaignId: string = CAMPAIGN) {
	try {
		await page(milestoneId, campaignId);
	} catch (thrown) {
		expect(isHttpError(thrown, 404)).toBe(true);
		return;
	}
	throw new Error('expected a not-found');
}

const setMilestone = (id: string, values: Partial<typeof milestones.$inferInsert>) =>
	test.db
		.update(milestones)
		.set(values)
		.where(and(eq(milestones.campaignId, CAMPAIGN), eq(milestones.id, id)));

/** Adds a work log with its 0.10 deposit, the way the check-in endpoint saves one. */
async function addLog(id: string, values: Partial<typeof entries.$inferInsert> = {}) {
	await test.db.insert(entries).values({
		id,
		campaignId: CAMPAIGN,
		milestoneId: 'm2-walls',
		partyId: contractor.id,
		item: 'log_work',
		inputs: {
			reporter_code: contractor.reporterCode,
			milestone_id: 'm2-walls',
			summary: 'East wall at lintel height.'
		},
		status: 'filed',
		statusReason: null,
		payingWallet: null,
		twistId: null,
		filedAt: '2026-11-14T10:00:00.000Z',
		stampedAt: null,
		updatedAt: '2026-11-14T10:00:00.000Z',
		...values
	});
	await test.db
		.insert(deposits)
		.values({ id: `dep-${id}`, entryId: id, amount: 100, refundedAt: null });
}

describe('the milestone page', () => {
	it('is not found for an unknown campaign or an unknown milestone', async () => {
		await notFound('m2-walls', 'no-such-campaign');
		await notFound('no-such-milestone');
	});

	it('is not found for a milestone that belongs to a different campaign', async () => {
		await test.db
			.insert(campaigns)
			.values({ ...fixtures.campaign, id: 'other-campaign', title: 'Another campaign' });

		await notFound('m2-walls', 'other-campaign');
	});

	it('shows the milestone, its place among the campaign’s milestones and who owes it', async () => {
		const data = await page('m2-walls');

		expect(data.today).toBe('2026-11-14');
		expect(data.total).toBe(3);
		expect(data.campaign).toEqual({
			id: CAMPAIGN,
			title: 'Rebuild the library wing',
			creatorName: 'Mangrove Bay Parent-Teacher Association'
		});
		expect(data.milestone).toEqual({
			id: 'm2-walls',
			position: 2,
			title: 'Walls up to roof height',
			description:
				'Block walls on all four sides to ring-beam height, with window and door openings formed.',
			kind: 'construction',
			dueDate: '2026-11-27',
			state: 'open',
			confirmed: false,
			confirmedAt: null,
			strength: null,
			daysLate: 0
		});
		expect(data.owner).toMatchObject({ name: 'Coral Ridge Builders', title: 'Contractor' });
	});

	it('names the confirmer with their recorded relationship, and says when none is recorded', async () => {
		expect((await page('m2-walls')).confirmer).toEqual({
			name: 'Yvonne Campbell',
			title: 'Head teacher, Mangrove Bay Primary School',
			role: 'confirmer',
			relationship: 'stakeholder',
			relationshipRecorded: true,
			relationshipReason: 'Head teacher of the school whose library is being rebuilt.'
		});

		// Not recorded is shown as stakeholder, never as independent, and the page is told.
		await setPartyRelationship(test.db, headTeacher.id, {
			relationship: null,
			relationshipReason: null
		});
		expect((await page('m2-walls')).confirmer).toMatchObject({
			relationship: 'stakeholder',
			relationshipRecorded: false,
			relationshipReason: null
		});
	});

	it('gives a confirmation its strength: the confirmer’s relationship, or participant for the creator', async () => {
		expect((await page('m1-foundation')).milestone).toMatchObject({
			confirmed: true,
			confirmedAt: '2026-10-30T09:41:07.000Z',
			strength: 'stakeholder'
		});

		await setPartyRelationship(test.db, headTeacher.id, {
			relationship: 'independent',
			relationshipReason: 'Employed by the parish council. Not paid by the project.'
		});
		expect((await page('m1-foundation')).milestone.strength).toBe('independent');

		await setMilestone('m3-books-delivered', {
			state: 'confirmed_creator',
			confirmedAt: '2026-11-13T10:00:00.000Z'
		});
		expect((await page('m3-books-delivered')).milestone.strength).toBe('participant');
	});

	it('marks a milestone overdue from the day after its due date, and never once confirmed', async () => {
		vi.setSystemTime(new Date('2026-11-20T23:59:00.000Z'));
		expect((await page('m3-books-delivered')).milestone.daysLate).toBe(0);

		vi.setSystemTime(new Date('2026-11-30T12:00:00.000Z'));
		// Claimed complete and overdue at once: overdue is an exception, not a state.
		expect((await page('m3-books-delivered')).milestone).toMatchObject({
			state: 'claimed',
			daysLate: 10
		});
		expect((await page('m1-foundation')).milestone.daysLate).toBe(0);
	});

	it('counts the filings by their filing status', async () => {
		expect((await page('m1-foundation')).filings).toEqual({
			total: 2,
			verified: 2,
			pending: 0,
			flagged: 0,
			incomplete: 0
		});
		expect((await page('m2-walls')).filings).toEqual({
			total: 2,
			verified: 0,
			pending: 1,
			flagged: 1,
			incomplete: 0
		});
		expect((await page('m3-books-delivered')).filings).toMatchObject({ total: 1, incomplete: 1 });
	});

	it('takes the latest progress from the newest work log, in the reporter’s own figures', async () => {
		expect((await page('m2-walls')).progress).toEqual({
			entryId: 'ent-m2-log-2',
			filedAt: '2026-11-13T17:02:19.000Z',
			percentComplete: 35,
			status: 'delayed',
			period: 'Week of 9 November'
		});
		expect((await page('m1-foundation')).progress).toBeNull();
	});

	it('takes the latest claim that the work is done, never the confirmation', async () => {
		expect((await page('m1-foundation')).claim).toEqual({
			entryId: 'ent-m1-claim',
			filedAt: '2026-10-29T15:12:40.000Z',
			claim: 'completed',
			quantity: null,
			unit: null
		});
		expect((await page('m2-walls')).claim).toBeNull();
	});

	it('says what an incomplete filing is still missing', async () => {
		expect((await page('m3-books-delivered')).missing).toEqual([
			{ entryId: 'ent-m3-delivery', reason: 'A delivery needs a quantity and a unit.' }
		]);
		expect((await page('m2-walls')).missing).toEqual([]);
	});

	it('shows only files from our evidence store, oldest filing first, and counts the rest', async () => {
		const photo = stored('jpg', 'a', 'East wall');
		const document = stored('pdf', 'b');
		await addLog('ent-good', {
			inputs: {
				reporter_code: contractor.reporterCode,
				milestone_id: 'm2-walls',
				summary: 'East wall at lintel height.',
				photos: [
					photo,
					document,
					{ url: 'https://elsewhere.example/evidence/photo.jpg', sha256: 'c'.repeat(64) },
					{ url: stored('jpg', 'd').url, sha256: 'e'.repeat(64) }
				]
			}
		});

		const data = await page('m2-walls');

		expect(data.evidence).toEqual([
			{
				entryId: 'ent-good',
				filedAt: '2026-11-14T10:00:00.000Z',
				kind: 'photo',
				url: photo.url,
				sha256: 'a'.repeat(64),
				caption: 'East wall'
			},
			{
				entryId: 'ent-good',
				filedAt: '2026-11-14T10:00:00.000Z',
				kind: 'document',
				url: document.url,
				sha256: 'b'.repeat(64),
				caption: null
			}
		]);
		// The two rejected here, and the three seeded example files, which are not in the store.
		expect(data.leftOut).toBe(5);
		expect(JSON.stringify(data)).not.toContain('elsewhere.example');
		expect(JSON.stringify(data)).not.toContain('evidence.tejido.example');
	});

	it('tells donors what a not-public file is and why, and never sends its address', async () => {
		const hidden = stored('pdf', 'f');
		await addLog('ent-hidden', {
			inputs: {
				reporter_code: contractor.reporterCode,
				milestone_id: 'm2-walls',
				summary: 'Site register attached.',
				photos: [hidden]
			}
		});
		await test.db.insert(evidenceFiles).values({
			sha256: hidden.sha256,
			uploadedByPartyId: contractor.id,
			visibility: 'not_public',
			notPublicKind: 'Site register',
			notPublicReason: 'It has workers’ names on it.',
			createdAt: '2026-11-14T10:00:00.000Z',
			updatedAt: '2026-11-14T10:00:00.000Z'
		});

		const data = await page('m2-walls');

		expect(data.notPublic).toEqual([
			{
				entryId: 'ent-hidden',
				filedAt: '2026-11-14T10:00:00.000Z',
				kind: 'Site register',
				reason: 'It has workers’ names on it.',
				sha256: hidden.sha256
			}
		]);
		expect(data.evidence).toEqual([]);
		expect(JSON.stringify(data)).not.toContain(hidden.url);
		expect(JSON.stringify(data)).not.toContain('/evidence/');
	});

	it('shows no picture on a milestone that takes documents only', async () => {
		await setMilestone('m2-walls', { kind: 'funds_handover' });
		await addLog('ent-fees', {
			inputs: {
				reporter_code: contractor.reporterCode,
				milestone_id: 'm2-walls',
				summary: 'Fees paid.',
				photos: [stored('jpg', 'a'), stored('pdf', 'b')]
			}
		});

		const data = await page('m2-walls');

		expect(data.evidence.map((file: { kind: string }) => file.kind)).toEqual(['document']);
		expect(JSON.stringify(data.evidence)).not.toContain('.jpg');
	});

	it('lists the milestone’s entries, newest first, for the history and its proof links', async () => {
		expect((await page('m1-foundation')).entries).toEqual([
			{
				id: 'ent-m1-confirm',
				item: 'milestone_hit',
				claim: 'confirm',
				status: 'verified',
				filedAt: '2026-10-30T09:41:07.000Z',
				filedBy: 'Yvonne Campbell'
			},
			{
				id: 'ent-m1-claim',
				item: 'milestone_hit',
				claim: 'completed',
				status: 'verified',
				filedAt: '2026-10-29T15:12:40.000Z',
				filedBy: 'Coral Ridge Builders'
			}
		]);
	});

	it('totals the deposits by state: held, refunded and refund outstanding', async () => {
		expect((await page('m1-foundation')).deposits).toEqual({
			count: 2,
			paid: 2000,
			held: 0,
			refunded: 2000,
			outstanding: 0,
			returned: 2000,
			outstandingMeanings: []
		});
		expect((await page('m2-walls')).deposits).toMatchObject({
			count: 2,
			paid: 200,
			held: 200,
			refunded: 0,
			outstanding: 0
		});
	});

	it('calls an unreturned deposit a refund outstanding once the milestone is confirmed, and says why', async () => {
		await setMilestone('m2-walls', {
			state: 'confirmed_independent',
			confirmedAt: '2026-11-14T09:00:00.000Z'
		});

		const { deposits: totals } = await page('m2-walls');

		expect(totals).toMatchObject({ paid: 200, held: 0, refunded: 0, outstanding: 200 });
		// One filing is flagged and the other is not matched to its receipt yet.
		expect(totals.outstandingMeanings).toHaveLength(2);
		expect(totals.outstandingMeanings.join(' ')).toContain('until a person has looked at it');
	});

	it('sends no reporter code, email address or wallet to the page', async () => {
		for (const milestone of fixtures.milestones) {
			const sent = JSON.stringify(await page(milestone.id));

			expect(sent).not.toContain('rc_');
			expect(sent).not.toContain('@');
			expect(sent).not.toContain('wallets.tejido.example');
			for (const party of fixtures.parties) {
				expect(sent).not.toContain(party.reporterCode);
				expect(sent).not.toContain(party.email);
			}
		}
	});
});
