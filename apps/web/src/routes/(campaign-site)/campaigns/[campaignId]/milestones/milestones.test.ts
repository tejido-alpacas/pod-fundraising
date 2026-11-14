// Calls the milestone status page's own load against a real, migrated, seeded database.
// Nothing here reaches the network.
import { isHttpError } from '@sveltejs/kit';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, deposits, entries, milestones } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server.ts';

const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;

/** What the page is sent about one milestone. */
interface Row {
	id: string;
	state: string;
	confirmedAt: string | null;
	dueDate: string;
	daysLate: number;
	owner: unknown;
	confirmer: unknown;
	progress: unknown;
	entries: {
		id: string;
		deposit: {
			entryId: string;
			amount: number;
			state: string;
			label: string;
			refundedAt: string | null;
			outstandingReason: string | null;
			outstandingMeaning: string | null;
		} | null;
	}[];
	deposits: { paid: number; held: number; refunded: number; outstanding: number; returned: number };
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

async function status(campaignId: string = CAMPAIGN) {
	const event = { params: { campaignId }, locals: { ctx: { db: test.db } } };
	const data = await load(event as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('the load returned nothing');
	const rows: Row[] = data.milestones;
	const row = (id: string) => {
		const found = rows.find((milestone) => milestone.id === id);
		if (!found) throw new Error(`no milestone ${id}`);
		return found;
	};
	return { data, rows, row };
}

const setState = (id: string, values: Partial<typeof milestones.$inferInsert>) =>
	test.db
		.update(milestones)
		.set(values)
		.where(and(eq(milestones.campaignId, CAMPAIGN), eq(milestones.id, id)));

describe('the milestone status page', () => {
	it('is not found for an unknown campaign', async () => {
		try {
			await status('no-such-campaign');
		} catch (thrown) {
			expect(isHttpError(thrown, 404)).toBe(true);
			return;
		}
		throw new Error('expected a not-found');
	});

	it('lists every milestone in order, each with its state', async () => {
		const { data, rows } = await status();

		expect(data.campaign).toEqual({
			id: CAMPAIGN,
			title: 'Rebuild the library wing',
			status: 'reporting'
		});
		expect(rows.map((row) => [row.id, row.state])).toEqual([
			['m1-foundation', 'confirmed_independent'],
			['m2-walls', 'open'],
			['m3-books-delivered', 'claimed']
		]);
	});

	it('names who owes and who confirms a milestone, by name and role only', async () => {
		const { row } = await status();

		expect(row('m3-books-delivered')).toMatchObject({
			owner: {
				name: 'Island Schoolbooks Co-operative',
				title: 'Book supplier',
				role: 'third_party'
			},
			confirmer: {
				name: 'Yvonne Campbell',
				title: 'Head teacher, Mangrove Bay Primary School',
				role: 'confirmer'
			}
		});
	});

	it('says when a milestone was confirmed, and shows a creator confirmation as its own state', async () => {
		await setState('m3-books-delivered', {
			state: 'confirmed_creator',
			confirmedAt: '2026-11-13T10:00:00.000Z'
		});

		const { row } = await status();

		expect(row('m1-foundation').confirmedAt).toBe('2026-10-30T09:41:07.000Z');
		expect(row('m3-books-delivered')).toMatchObject({
			state: 'confirmed_creator',
			confirmedAt: '2026-11-13T10:00:00.000Z'
		});
		expect(row('m2-walls').confirmedAt).toBeNull();
	});

	it('takes the latest progress from the most recent work log', async () => {
		const { row } = await status();

		expect(row('m2-walls').progress).toEqual({
			entryId: 'ent-m2-log-2',
			filedAt: '2026-11-13T17:02:19.000Z',
			percentComplete: 35,
			status: 'delayed',
			period: 'Week of 9 November'
		});
		// Claims and confirmations are not work logs.
		expect(row('m1-foundation').progress).toBeNull();
		expect(row('m3-books-delivered').progress).toBeNull();
	});

	it('shows a latest work log that gave no percent or status as not given', async () => {
		await test.db.insert(entries).values({
			id: 'ent-m2-log-3',
			campaignId: CAMPAIGN,
			milestoneId: 'm2-walls',
			partyId: contractor.id,
			item: 'log_work',
			inputs: {
				reporter_code: contractor.reporterCode,
				milestone_id: 'm2-walls',
				summary: 'Waiting on a block delivery.'
			},
			status: 'filed',
			statusReason: null,
			payingWallet: null,
			twistId: null,
			filedAt: '2026-11-14T08:00:00.000Z',
			stampedAt: null,
			updatedAt: '2026-11-14T08:00:00.000Z'
		});

		const { row } = await status();

		expect(row('m2-walls').progress).toEqual({
			entryId: 'ent-m2-log-3',
			filedAt: '2026-11-14T08:00:00.000Z',
			percentComplete: null,
			status: null,
			period: null
		});
	});

	it('lists each milestone’s entries, newest first, for linking to their proof pages', async () => {
		const { row } = await status();

		expect(row('m1-foundation').entries).toEqual([
			{
				id: 'ent-m1-confirm',
				item: 'milestone_hit',
				claim: 'confirm',
				status: 'verified',
				filedAt: '2026-10-30T09:41:07.000Z',
				filedBy: 'Yvonne Campbell',
				deposit: {
					entryId: 'ent-m1-confirm',
					amount: 1000,
					state: 'refunded',
					label: 'Deposit refunded',
					refundedAt: '2026-10-30T09:45:00.000Z',
					outstandingReason: null,
					outstandingMeaning: null
				}
			},
			{
				id: 'ent-m1-claim',
				item: 'milestone_hit',
				claim: 'completed',
				status: 'verified',
				filedAt: '2026-10-29T15:12:40.000Z',
				filedBy: 'Coral Ridge Builders',
				deposit: {
					entryId: 'ent-m1-claim',
					amount: 1000,
					state: 'refunded',
					label: 'Deposit refunded',
					refundedAt: '2026-10-30T09:45:00.000Z',
					outstandingReason: null,
					outstandingMeaning: null
				}
			}
		]);
		expect(row('m2-walls').entries.map((entry) => entry.id)).toEqual([
			'ent-m2-log-2',
			'ent-m2-log-1'
		]);
	});

	it('totals the deposits on each milestone by state: held, refunded, outstanding', async () => {
		const { row } = await status();

		expect(row('m1-foundation').deposits).toEqual({
			paid: 2000,
			held: 0,
			refunded: 2000,
			outstanding: 0,
			returned: 2000
		});
		// Not confirmed yet, so these deposits are held.
		expect(row('m2-walls').deposits).toEqual({
			paid: 200,
			held: 200,
			refunded: 0,
			outstanding: 0,
			returned: 0
		});
		expect(row('m3-books-delivered').deposits).toEqual({
			paid: 1000,
			held: 1000,
			refunded: 0,
			outstanding: 0,
			returned: 0
		});
	});

	it('counts a deposit as refunded only once it has been refunded', async () => {
		await test.db
			.update(deposits)
			.set({ refundedAt: '2026-11-14T09:00:00.000Z' })
			.where(eq(deposits.id, 'dep-m2-log-1'));

		expect((await status()).row('m2-walls').deposits).toEqual({
			paid: 200,
			held: 100,
			refunded: 100,
			outstanding: 0,
			returned: 100
		});
	});

	it('gives each entry its deposit with one of the three labels', async () => {
		const { row } = await status();

		expect(row('m1-foundation').entries.map((entry) => entry.deposit?.label)).toEqual([
			'Deposit refunded',
			'Deposit refunded'
		]);
		expect(row('m2-walls').entries[0]?.deposit).toEqual({
			entryId: 'ent-m2-log-2',
			amount: 100,
			state: 'held',
			label: 'Deposit held',
			refundedAt: null,
			outstandingReason: null,
			outstandingMeaning: null
		});
	});

	it('calls deposits on a confirmed milestone outstanding, not held, until they are refunded', async () => {
		await test.db
			.update(milestones)
			.set({ state: 'confirmed_independent', confirmedAt: '2026-11-14T09:00:00.000Z' })
			.where(eq(milestones.id, 'm2-walls'));

		const walls = (await status()).row('m2-walls');

		expect(walls.deposits).toEqual({
			paid: 200,
			held: 0,
			refunded: 0,
			outstanding: 200,
			returned: 0
		});
		// Newest first: the filed entry, then the flagged one.
		expect(
			walls.entries.map((entry) => [entry.deposit?.label, entry.deposit?.outstandingReason])
		).toEqual([
			['Refund outstanding', 'entry_not_verified'],
			['Refund outstanding', 'entry_flagged']
		]);
	});

	it('marks no milestone late while every unconfirmed one is still before its due date', async () => {
		const { rows } = await status();

		// m1 was due on 30 October, but it is confirmed.
		expect(rows.map((row) => row.daysLate)).toEqual([0, 0, 0]);
	});

	it('marks an unconfirmed milestone late from the day after its due date', async () => {
		vi.setSystemTime(new Date('2026-11-20T23:59:00.000Z'));
		expect((await status()).row('m3-books-delivered').daysLate).toBe(0);

		vi.setSystemTime(new Date('2026-11-21T00:01:00.000Z'));
		expect((await status()).row('m3-books-delivered').daysLate).toBe(1);

		vi.setSystemTime(new Date('2026-11-30T12:00:00.000Z'));
		const { rows } = await status();
		// m1 confirmed; m2 (open, due 27 Nov) and m3 (claimed, due 20 Nov) are both late.
		expect(rows.map((row) => row.daysLate)).toEqual([0, 3, 10]);
	});

	it('stops marking a milestone late once it is confirmed, by either route', async () => {
		vi.setSystemTime(new Date('2026-11-30T12:00:00.000Z'));
		await setState('m3-books-delivered', {
			state: 'confirmed_creator',
			confirmedAt: '2026-11-29T10:00:00.000Z'
		});

		expect((await status()).row('m3-books-delivered').daysLate).toBe(0);
	});

	it('passes on the campaign’s own overdue status', async () => {
		await test.db.update(campaigns).set({ status: 'overdue' }).where(eq(campaigns.id, CAMPAIGN));

		expect((await status()).data.campaign.status).toBe('overdue');
	});

	it('sends no reporter code, email address or wallet to the page', async () => {
		const sent = JSON.stringify((await status()).data);

		expect(sent).not.toContain('rc_');
		expect(sent).not.toContain('@');
		expect(sent).not.toContain('wallets.tejido.example');
		for (const party of fixtures.parties) {
			expect(sent).not.toContain(party.reporterCode);
			expect(sent).not.toContain(party.email);
		}
	});
});
