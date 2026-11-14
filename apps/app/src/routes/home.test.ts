// The home page and the header on every page: their own load functions, run against a real,
// migrated, seeded local D1. Each kind of viewer gets what they need and nothing private.
//
// Nothing reaches the network: `fetch` is replaced by a stub that fails the test if anything
// calls it, and the Qatom clients are replaced by one that fails the test if anything touches
// them. Showing a page must never talk to Qatom.
import { fixtures } from '@tejido/contracts/fixtures';
import { parties } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '#lib/server/session.ts';
import { load as layoutLoad } from './+layout.server.ts';
import { load as pageLoad } from './+page.server.ts';

const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

const sessionFor = (party: typeof contractor): Session => ({
	sub: `qatom-user-${party.id}`,
	email: party.email,
	partyId: party.id
});
const noParty: Session = { sub: 'qatom-user-9', email: 'someone@else.example', partyId: null };

let test: TestDatabase;
const fetchStub = vi.fn(() => Promise.reject(new Error('a test reached the network')));
const touchedQatom = vi.fn();
/** Any use of a Qatom client is recorded, then fails. */
const qatom = new Proxy(
	{},
	{
		get: (_, name) => {
			touchedQatom(name);
			throw new Error(`a test touched Qatom: ${String(name)}`);
		}
	}
);

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	vi.stubGlobal('fetch', fetchStub);
	// Only the clock is replaced, so "overdue" does not depend on the day the tests run.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
});

afterEach(async () => {
	expect(fetchStub).not.toHaveBeenCalled();
	expect(touchedQatom).not.toHaveBeenCalled();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	await test.destroy();
});

// A whole RequestEvent cannot be built outside SvelteKit; these loads use only `locals`.
const locals = (session: Session | null) => ({ locals: { ctx: { db: test.db, qatom }, session } });
const home = (session: Session | null) =>
	pageLoad(locals(session) as unknown as Parameters<typeof pageLoad>[0]);
const header = (session: Session | null) =>
	layoutLoad(locals(session) as unknown as Parameters<typeof layoutLoad>[0]);

/** Everything that must never be sent to a browser, for every party in the fixtures. */
function expectNothingPrivate(sent: unknown, viewer: typeof contractor | null) {
	const text = JSON.stringify(sent);
	for (const party of fixtures.parties) {
		expect(text).not.toContain(party.reporterCode);
		if (party.agentWalletHostname) expect(text).not.toContain(party.agentWalletHostname);
		if (party.primaryWalletHostname) expect(text).not.toContain(party.primaryWalletHostname);
		// A person sees their own email address and nobody else's.
		if (party.id !== viewer?.id) {
			expect(text).not.toContain(party.email);
			expect(text).not.toContain(party.name);
		}
	}
	expect(text).not.toContain(fixtures.campaign.creatorEmail);
	expect(text).not.toMatch(/token/i);
}

describe('the home page', () => {
	it('tells someone who is not signed in only that', async () => {
		expect(await home(null)).toEqual({ viewer: 'signed_out' });
	});

	it('tells someone signed in without a campaign so, with their own email only', async () => {
		const sent = await home(noParty);
		expect(sent).toEqual({ viewer: 'no_party', email: noParty.email });
		expectNothingPrivate(sent, null);
	});

	it('treats a session for a party that no longer exists as not on a campaign', async () => {
		const sent = await home({ ...noParty, partyId: 'nobody' });
		expect(sent).toEqual({ viewer: 'no_party', email: noParty.email });
	});

	it('shows the contractor their campaign and the milestone they owe next', async () => {
		const sent = await home(sessionFor(contractor));
		expect(sent).toEqual({
			viewer: 'party',
			email: contractor.email,
			party: {
				id: contractor.id,
				name: contractor.name,
				title: contractor.title,
				role: 'third_party',
				walletsLinked: true
			},
			campaign: { title: fixtures.campaign.title, cadence: fixtures.campaign.cadence },
			incompleteReports: 0,
			milestones: [
				{
					id: 'm1-foundation',
					title: 'Foundation and floor slab',
					dueDate: '2026-10-30',
					part: 'owes',
					step: 'done',
					overdue: false
				},
				{
					id: 'm2-walls',
					title: 'Walls up to roof height',
					dueDate: '2026-11-27',
					part: 'owes',
					step: 'claim',
					overdue: false
				}
			]
		});
		expectNothingPrivate(sent, contractor);
	});

	it('marks a milestone overdue once its date has passed without a claim', async () => {
		vi.setSystemTime(new Date('2026-11-28T00:00:01.000Z'));
		expect(await home(sessionFor(contractor))).toMatchObject({
			viewer: 'party',
			milestones: [
				// A finished milestone is never overdue, however old.
				{ id: 'm1-foundation', step: 'done', overdue: false },
				{ id: 'm2-walls', step: 'claim', overdue: true }
			]
		});
	});

	it('tells the supplier one report is incomplete and their claim is waiting', async () => {
		const sent = await home(sessionFor(supplier));
		expect(sent).toMatchObject({
			viewer: 'party',
			incompleteReports: 1,
			milestones: [
				{
					id: 'm3-books-delivered',
					title: 'Books delivered',
					dueDate: '2026-11-20',
					part: 'owes',
					step: 'waiting',
					overdue: false
				}
			]
		});
		expectNothingPrivate(sent, supplier);
	});

	it('shows the confirmer what is waiting for them to confirm', async () => {
		const sent = await home(sessionFor(headTeacher));
		expect(sent).toMatchObject({
			viewer: 'party',
			party: { role: 'confirmer' },
			incompleteReports: 0,
			// Soonest first.
			milestones: [
				{ id: 'm1-foundation', part: 'confirms', step: 'done', overdue: false },
				{ id: 'm3-books-delivered', part: 'confirms', step: 'confirm', overdue: false },
				{ id: 'm2-walls', part: 'confirms', step: 'waiting', overdue: false }
			]
		});
		expectNothingPrivate(sent, headTeacher);
	});

	it('says when a party has not linked their wallets yet', async () => {
		await test.db
			.update(parties)
			.set({ agentWalletHostname: null, primaryWalletHostname: null })
			.where(eq(parties.id, contractor.id));
		expect(await home(sessionFor(contractor))).toMatchObject({
			viewer: 'party',
			party: { walletsLinked: false }
		});
	});
});

describe('the header on every page', () => {
	it('has nothing for someone who is not signed in', async () => {
		expect(await header(null)).toEqual({ nav: null });
	});

	it('shows only the email of someone who is not on a campaign', async () => {
		expect(await header(noParty)).toEqual({ nav: { email: noParty.email, party: null } });
		expect(await header({ ...noParty, partyId: 'nobody' })).toEqual({
			nav: { email: noParty.email, party: null }
		});
	});

	it('shows a party their name and no reports to fix when none is incomplete', async () => {
		const sent = await header(sessionFor(contractor));
		expect(sent).toEqual({
			header: {
				title: fixtures.campaign.title,
				subtitle: `${contractor.name} · ${contractor.title}`
			},
			nav: { email: contractor.email, party: { name: contractor.name, incompleteReports: 0 } }
		});
		expectNothingPrivate(sent, contractor);
	});

	it('counts the incomplete reports of the party looking, and nobody else', async () => {
		const sent = await header(sessionFor(supplier));
		expect(sent).toEqual({
			header: { title: fixtures.campaign.title, subtitle: `${supplier.name} · ${supplier.title}` },
			nav: { email: supplier.email, party: { name: supplier.name, incompleteReports: 1 } }
		});
		expectNothingPrivate(sent, supplier);
		expect(await header(sessionFor(headTeacher))).toMatchObject({
			nav: { party: { incompleteReports: 0 } }
		});
	});
});
