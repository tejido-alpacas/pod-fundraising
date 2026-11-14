// Calls the final report's own load against a real, migrated, seeded database. Nothing here
// reaches the network.
import { isHttpError } from '@sveltejs/kit';
import type { Entry, MilestoneHitEntry } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, deposits, entries, milestones, refunds } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { load } from './+page.server.ts';

const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

// The evidence store is the App, which is also where the sign-in callback is.
const APP = 'http://localhost:5174';

/** A file as the evidence upload would return it: stored under its own SHA-256. */
function evidence(extension: 'jpg' | 'pdf', fill: string, caption?: string) {
	const sha256 = fill.repeat(64);
	return { url: `${APP}/evidence/${sha256}.${extension}`, sha256, ...(caption ? { caption } : {}) };
}

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test.destroy());

async function report(campaignId: string = CAMPAIGN) {
	const event = {
		params: { campaignId },
		locals: { ctx: { db: test.db, config: { OIDC_REDIRECT_URI: `${APP}/auth/callback` } } }
	};
	const data = await load(event as unknown as Parameters<typeof load>[0]);
	const row = (id: string) => {
		const found = data.milestones.find((milestone) => milestone.id === id);
		if (!found) throw new Error(`no milestone ${id}`);
		return found;
	};
	return { data, row };
}

const setMilestone = (id: string, values: Partial<typeof milestones.$inferInsert>) =>
	test.db
		.update(milestones)
		.set(values)
		.where(and(eq(milestones.campaignId, CAMPAIGN), eq(milestones.id, id)));

/** Saves a milestone-hit entry and its 1.00 deposit. */
async function addHit(
	id: string,
	party: (typeof fixtures.parties)[number],
	milestoneId: string,
	filedAt: string,
	inputs: Partial<MilestoneHitEntry['inputs']> & Pick<MilestoneHitEntry['inputs'], 'claim'>,
	refundedAt: string | null = null
) {
	const entry: Entry = {
		id,
		campaignId: CAMPAIGN,
		milestoneId,
		partyId: party.id,
		item: 'milestone_hit',
		status: 'verified',
		statusReason: null,
		payingWallet: party.agentWalletHostname,
		twistId: `41${id.padEnd(64, '0')}`,
		filedAt,
		stampedAt: filedAt,
		updatedAt: filedAt,
		inputs: {
			reporter_code: party.reporterCode,
			milestone_id: milestoneId,
			summary: `Summary of ${id}.`,
			...inputs
		}
	};
	await test.db.insert(entries).values(entry);
	await test.db.insert(deposits).values({ id: `dep-${id}`, entryId: id, amount: 1000, refundedAt });
}

/**
 * Finishes the fixture campaign: the walls are claimed and confirmed by the head teacher, and
 * the books, which nobody independent answered for, are confirmed by the creator.
 */
async function deliver() {
	await addHit('ent-m2-claim', contractor, 'm2-walls', '2026-11-26T10:00:00.000Z', {
		claim: 'completed',
		photos: [evidence('jpg', 'a', 'All four walls'), evidence('pdf', 'b', 'Inspection report')]
	});
	await addHit('ent-m2-confirm', headTeacher, 'm2-walls', '2026-11-27T09:00:00.000Z', {
		claim: 'confirm'
	});
	await setMilestone('m2-walls', {
		state: 'confirmed_independent',
		confirmedAt: '2026-11-27T09:00:00.000Z'
	});
	await setMilestone('m3-books-delivered', {
		state: 'confirmed_creator',
		confirmedAt: '2026-12-04T12:00:00.000Z'
	});
}

describe('the final report', () => {
	it('is not found for an unknown campaign', async () => {
		try {
			await report('no-such-campaign');
		} catch (thrown) {
			expect(isHttpError(thrown, 404)).toBe(true);
			return;
		}
		throw new Error('expected a not-found');
	});

	describe('for a campaign that is not finished', () => {
		it('says so and names every milestone still outstanding, instead of a not-found', async () => {
			const { data } = await report();

			expect(data.delivered).toBe(false);
			expect(data.deliveredAt).toBeNull();
			expect(data.outstanding).toEqual([
				{
					id: 'm2-walls',
					title: 'Walls up to roof height',
					state: 'open',
					dueDate: '2026-11-27',
					owner: { name: 'Coral Ridge Builders', title: 'Contractor', role: 'third_party' },
					namedConfirmer: {
						name: 'Yvonne Campbell',
						title: 'Head teacher, Mangrove Bay Primary School',
						role: 'confirmer'
					}
				},
				expect.objectContaining({ id: 'm3-books-delivered', state: 'claimed' })
			]);
			expect(data.totals).toMatchObject({ milestones: 3, confirmed: 1, independent: 1 });
		});

		it('still lists every milestone in order, and names nobody as confirming an unconfirmed one', async () => {
			const { data, row } = await report();

			expect(data.milestones.map((milestone) => [milestone.id, milestone.confirmed])).toEqual([
				['m1-foundation', true],
				['m2-walls', false],
				['m3-books-delivered', false]
			]);
			expect(row('m2-walls')).toMatchObject({
				confirmedBy: null,
				confirmedAt: null,
				signOff: null
			});
			expect(row('m3-books-delivered')).toMatchObject({ confirmedBy: null, signOff: null });
		});

		it('does not call a campaign delivered because its status says so', async () => {
			await test.db
				.update(campaigns)
				.set({ status: 'delivered' })
				.where(eq(campaigns.id, CAMPAIGN));

			const { data } = await report();

			expect(data.delivered).toBe(false);
			expect(data.outstanding).toHaveLength(2);
		});

		it('is not delivered when the campaign has no milestones at all', async () => {
			await test.db.insert(campaigns).values({
				...fixtures.campaign,
				id: 'empty',
				logWorkCommodityId: null,
				milestoneHitCommodityId: null
			});

			const { data } = await report('empty');

			expect(data).toMatchObject({ delivered: false, milestones: [], outstanding: [] });
		});
	});

	describe('for a delivered campaign', () => {
		beforeEach(deliver);

		it('is delivered, as of the last confirmation, with nothing outstanding', async () => {
			const { data } = await report();

			expect(data.delivered).toBe(true);
			expect(data.deliveredAt).toBe('2026-12-04T12:00:00.000Z');
			expect(data.outstanding).toEqual([]);
			expect(data.totals).toMatchObject({
				milestones: 3,
				confirmed: 3,
				independent: 2,
				byCreator: 1
			});
		});

		it('says who confirmed each milestone, when, and how strongly', async () => {
			const { row } = await report();

			expect(row('m1-foundation')).toMatchObject({
				state: 'confirmed_independent',
				confirmedAt: '2026-10-30T09:41:07.000Z',
				confirmedBy: {
					who: 'confirmer',
					name: 'Yvonne Campbell',
					title: 'Head teacher, Mangrove Bay Primary School'
				},
				owner: { name: 'Coral Ridge Builders', title: 'Contractor', role: 'third_party' }
			});
			// Confirmed by the creator: the creator's name, and never the named confirmer's.
			expect(row('m3-books-delivered')).toMatchObject({
				state: 'confirmed_creator',
				confirmedAt: '2026-12-04T12:00:00.000Z',
				confirmedBy: {
					who: 'creator',
					name: 'Mangrove Bay Parent-Teacher Association',
					title: null
				}
			});
		});

		it('gives the receipt of each sign-off, linking to its proof page', async () => {
			const { row } = await report();

			expect(row('m1-foundation').signOff).toEqual({
				entryId: 'ent-m1-confirm',
				filedBy: 'Yvonne Campbell',
				filedAt: '2026-10-30T09:41:07.000Z',
				status: 'verified',
				twistId: '414c8f9aaed10dc2fb4c5b20f61cc65e80ff1395d34d36b5e33f10f074f40c26be',
				payingWallet: 'yvonne-campbell-agent.wallets.tejido.example',
				proofPath: '/campaigns/library-wing/entries/ent-m1-confirm'
			});
			// No confirmation entry was filed on the books: none is made up.
			expect(row('m3-books-delivered').signOff).toBeNull();
		});

		it('lists the claims and confirmations behind a milestone, newest first, and counts its work logs', async () => {
			const { data, row } = await report();
			const walls = row('m2-walls');

			expect(walls.evidence.map((entry) => [entry.entryId, entry.kind, entry.claim])).toEqual([
				['ent-m2-confirm', 'confirmation', 'confirm'],
				['ent-m2-claim', 'claim', 'completed']
			]);
			expect(walls.evidence[1]).toMatchObject({
				filedBy: { name: 'Coral Ridge Builders', title: 'Contractor', role: 'third_party' },
				filedAt: '2026-11-26T10:00:00.000Z',
				status: 'verified',
				summary: 'Summary of ent-m2-claim.',
				proofPath: '/campaigns/library-wing/entries/ent-m2-claim'
			});
			expect(walls.workLogs).toBe(2);
			expect(walls.flaggedCount).toBe(1);
			expect(row('m1-foundation').workLogs).toBe(0);
			expect(data.totals).toMatchObject({ workLogs: 2, entries: 7, flagged: 1 });
		});

		it('shows a file only when it is in our evidence store, and counts the ones left out', async () => {
			const { row } = await report();

			// Uploaded to the App: shown.
			expect(row('m2-walls').evidence[1]!.files).toEqual({
				photos: [
					{
						url: `${APP}/evidence/${'a'.repeat(64)}.jpg`,
						sha256: 'a'.repeat(64),
						caption: 'All four walls'
					}
				],
				documents: [
					{
						url: `${APP}/evidence/${'b'.repeat(64)}.pdf`,
						sha256: 'b'.repeat(64),
						caption: 'Inspection report'
					}
				],
				leftOut: 0
			});
			// The fixtures' files are at another address: left out, and counted.
			expect(row('m1-foundation').evidence[1]!.files).toEqual({
				photos: [],
				documents: [],
				leftOut: 2
			});
			expect(JSON.stringify((await report()).data)).not.toContain('evidence.tejido.example');
		});

		it('shows no picture on a milestone that takes documents only', async () => {
			await setMilestone('m2-walls', { kind: 'service' });

			expect((await report()).row('m2-walls').evidence[1]!.files).toMatchObject({
				photos: [],
				documents: [expect.objectContaining({ caption: 'Inspection report' })],
				leftOut: 1
			});
		});

		it('totals the deposits paid and returned, from what is recorded', async () => {
			const { data, row } = await report();

			expect(row('m1-foundation').deposits).toEqual({
				paid: 2000,
				held: 0,
				refunded: 2000,
				outstanding: 0,
				returned: 2000,
				lastRefundedAt: '2026-10-30T09:45:00.000Z'
			});
			// Confirmed, but no refund is recorded on these deposits: none is called refunded, and
			// none is called held either. The refunds are outstanding.
			expect(row('m2-walls').deposits).toEqual({
				paid: 2200,
				held: 0,
				refunded: 0,
				outstanding: 2200,
				returned: 0,
				lastRefundedAt: null
			});
			expect(row('m2-walls').depositStates.map(({ label }) => label)).toEqual(
				Array.from({ length: 4 }, () => 'Refund outstanding')
			);
			expect(row('m1-foundation').depositStates.map(({ label }) => label)).toEqual([
				'Deposit refunded',
				'Deposit refunded'
			]);
			expect(row('m2-walls').refunds).toEqual([]);
			expect(data.totals).toMatchObject({
				paid: 5200,
				returned: 2000,
				held: 0,
				refunded: 2000,
				outstanding: 3200
			});
		});

		it('shows a recorded refund transfer: to whom, which wallet, how much and when', async () => {
			const refund = {
				campaignId: CAMPAIGN,
				milestoneId: 'm2-walls',
				dq: 'dq-hash-not-shown',
				statusReason: null,
				startedAt: '2026-11-27T09:01:00.000Z'
			};
			await test.db.insert(refunds).values([
				{
					...refund,
					id: 'rfd-contractor',
					partyId: contractor.id,
					primaryWalletHostname: contractor.primaryWalletHostname!,
					amount: 1100,
					status: 'sent',
					settledAt: '2026-11-27T09:01:05.000Z'
				},
				{
					...refund,
					id: 'rfd-head-teacher',
					partyId: headTeacher.id,
					primaryWalletHostname: headTeacher.primaryWalletHostname!,
					amount: 1000,
					status: 'unknown',
					settledAt: '2026-11-27T09:01:30.000Z'
				},
				{
					...refund,
					id: 'rfd-refused',
					partyId: supplier.id,
					primaryWalletHostname: supplier.primaryWalletHostname!,
					amount: 100,
					status: 'failed',
					settledAt: '2026-11-27T09:01:40.000Z'
				}
			]);

			const { data, row } = await report();

			// A refused transfer moved nothing, so it is not listed.
			expect(row('m2-walls').refunds).toEqual([
				{
					to: 'Coral Ridge Builders',
					wallet: 'coral-ridge.wallets.tejido.example',
					amount: 1100,
					outcome: 'sent',
					at: '2026-11-27T09:01:05.000Z'
				},
				{
					to: 'Yvonne Campbell',
					wallet: 'yvonne-campbell.wallets.tejido.example',
					amount: 1000,
					outcome: 'unknown',
					at: null
				}
			]);
			expect(JSON.stringify(data)).not.toContain('dq-hash-not-shown');
		});

		it('sends no reporter code, email address, session or token to the page', async () => {
			const sent = JSON.stringify((await report()).data);

			expect(sent).not.toContain('rc_');
			expect(sent).not.toContain('@');
			expect(sent).not.toContain('reporter');
			expect(sent).not.toMatch(/email|session|token/i);
			expect(sent).not.toContain(fixtures.campaign.creatorEmail);
			for (const party of fixtures.parties) {
				expect(sent).not.toContain(party.reporterCode);
				expect(sent).not.toContain(party.email);
			}
		});
	});

	it('sends nothing private for an unfinished campaign either', async () => {
		const sent = JSON.stringify((await report()).data);

		expect(sent).not.toContain('rc_');
		expect(sent).not.toContain('@');
		expect(sent).not.toMatch(/reporter|email|session|token/i);
	});
});
