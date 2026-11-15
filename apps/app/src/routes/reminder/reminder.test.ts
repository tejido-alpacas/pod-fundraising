// The reminder page (B4): its own load function, run against a real, migrated, seeded local D1,
// for every kind of person who can open a reminder's link.
//
// Nothing reaches the network: `fetch` is replaced by a stub that fails the test if anything
// calls it, and the Qatom clients are replaced by one that fails the test if anything touches
// them. Showing a reminder must never talk to Qatom, and nothing here sends a message.
import { fixtures } from '@tejido/contracts/fixtures';
import { milestones } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeReturnTo } from '#lib/return-to.ts';
import type { Session } from '#lib/server/session.ts';
import { load } from './+page.server.ts';

const APP = 'http://localhost:5174';
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

/** Opens a reminder link. A whole RequestEvent cannot be built outside SvelteKit. */
async function open(session: Session | null, query = '') {
	const event = {
		url: new URL(`${APP}/reminder${query}`),
		locals: { ctx: { db: test.db, qatom }, session }
	};
	const sent = await load(event as unknown as Parameters<typeof load>[0]);
	if (!sent) throw new Error('the reminder page was given nothing');
	return sent;
}

/** What must never be sent to a browser, for every party; and nobody's details but the viewer's. */
function expectNothingPrivate(sent: unknown, viewer: typeof contractor | null) {
	const text = JSON.stringify(sent);
	for (const party of fixtures.parties) {
		expect(text).not.toContain(party.reporterCode);
		if (party.agentWalletHostname) expect(text).not.toContain(party.agentWalletHostname);
		if (party.primaryWalletHostname) expect(text).not.toContain(party.primaryWalletHostname);
		expect(text).not.toContain(party.email);
		if (party.id !== viewer?.id) expect(text).not.toContain(party.name);
	}
	expect(text).not.toMatch(/token/i);
}

const walls = {
	id: 'm2-walls',
	position: 2,
	title: 'Walls up to roof height',
	dueDate: '2026-11-27',
	part: 'owes',
	step: 'claim',
	status: 'in-progress',
	overdueDays: 0,
	overdue: false
};

describe('a reminder opened by someone who is not signed in', () => {
	it('names no project, person or milestone, and offers sign-in that comes back here', async () => {
		const sent = await open(null, '?milestone=m2-walls');

		expect(sent).toEqual({
			viewer: 'signed_out',
			signInHref: '/auth/sign-in?return_to=%2Freminder%3Fmilestone%3Dm2-walls'
		});
		// Sign-in reads that address back as this same reminder.
		const returnTo = new URL(`${APP}${sent.signInHref}`).searchParams.get('return_to');
		expect(safeReturnTo(returnTo, APP)).toBe('/reminder?milestone=m2-walls');
	});

	it('says the same for a milestone that does not exist, so nothing can be learned from it', async () => {
		const real = await open(null, '?milestone=m2-walls');
		const made = await open(null, '?milestone=no-such-milestone');

		expect(Object.keys(made)).toEqual(Object.keys(real));
		expect(JSON.stringify(made)).not.toContain(fixtures.campaign.title);
	});

	it('comes back to the work-log reminder when the link names no milestone', async () => {
		expect(await open(null)).toEqual({
			viewer: 'signed_out',
			signInHref: '/auth/sign-in?return_to=%2Freminder'
		});
	});

	it('starts the sign-in as the invited party when the link carries one we know', async () => {
		const sent = await open(null, `?milestone=m2-walls&party=${contractor.id}`);
		expect(sent).toMatchObject({
			signInHref: '/auth/sign-in?party=contractor&return_to=%2Freminder%3Fmilestone%3Dm2-walls'
		});
		expectNothingPrivate(sent, null);

		// A party we do not know is left out rather than passed on.
		expect(await open(null, '?party=nobody')).toEqual({
			viewer: 'signed_out',
			signInHref: '/auth/sign-in?return_to=%2Freminder'
		});
	});
});

describe('a reminder opened by someone signed in without a project', () => {
	it('says so with their own email only, and has no sign-in to offer without a party', async () => {
		const sent = await open(noParty, '?milestone=m2-walls');
		expect(sent).toEqual({ viewer: 'no_party', email: noParty.email, signInHref: null });
		expectNothingPrivate(sent, null);
	});

	it('offers the invited party’s sign-in when the link carries it', async () => {
		expect(await open(noParty, `?milestone=m2-walls&party=${contractor.id}`)).toMatchObject({
			viewer: 'no_party',
			signInHref: '/auth/sign-in?party=contractor&return_to=%2Freminder%3Fmilestone%3Dm2-walls'
		});
	});

	it('treats a session for a party that no longer exists the same way', async () => {
		expect(await open({ ...noParty, partyId: 'nobody' })).toMatchObject({ viewer: 'no_party' });
	});
});

describe('a reminder for a milestone, opened by the party it is due from', () => {
	it('says what is due and by when, and opens the chat for exactly that milestone', async () => {
		const sent = await open(sessionFor(contractor), '?milestone=m2-walls');

		expect(sent).toEqual({
			viewer: 'party',
			party: { name: contractor.name, title: contractor.title, role: 'third_party' },
			campaign: { title: fixtures.campaign.title, cadence: fixtures.campaign.cadence },
			due: { kind: 'milestone', milestone: walls },
			chatHref: '/chat?milestone=m2-walls',
			alsoDueHref: null
		});
		expectNothingPrivate(sent, contractor);
	});

	it('says how many days overdue it is once its date has passed', async () => {
		vi.setSystemTime(new Date('2026-11-30T08:00:00.000Z'));

		expect(await open(sessionFor(contractor), '?milestone=m2-walls')).toMatchObject({
			due: { kind: 'milestone', milestone: { overdueDays: 3, overdue: true } }
		});
	});

	it('asks the confirmer to confirm a milestone that has been reported as done', async () => {
		const sent = await open(sessionFor(headTeacher), '?milestone=m3-books-delivered');

		expect(sent).toMatchObject({
			due: {
				kind: 'milestone',
				milestone: { id: 'm3-books-delivered', part: 'confirms', step: 'confirm' }
			},
			chatHref: '/chat?milestone=m3-books-delivered'
		});
		expectNothingPrivate(sent, headTeacher);
	});
});

describe('a reminder for a milestone with nothing for this person to do', () => {
	it('never shows another party’s milestone, and says the same as for one that does not exist', async () => {
		// m3 is the supplier's to report and the head teacher's to confirm: not the contractor's.
		const others = await open(sessionFor(contractor), '?milestone=m3-books-delivered');
		const made = await open(sessionFor(contractor), '?milestone=no-such-milestone');

		expect(others).toMatchObject({
			viewer: 'party',
			due: { kind: 'nothing', why: 'not_yours' },
			chatHref: null
		});
		expect(made).toEqual(others);
		expect(JSON.stringify(others)).not.toContain('Books delivered');
		expectNothingPrivate(others, contractor);
	});

	it('says a confirmed milestone is confirmed', async () => {
		expect(await open(sessionFor(contractor), '?milestone=m1-foundation')).toMatchObject({
			due: { kind: 'nothing', why: 'confirmed', milestone: { id: 'm1-foundation' } },
			chatHref: null
		});
	});

	it('says when the next move is someone else’s', async () => {
		// The supplier has reported it; the confirmer acts next.
		expect(await open(sessionFor(supplier), '?milestone=m3-books-delivered')).toMatchObject({
			due: { kind: 'nothing', why: 'waiting', milestone: { part: 'owes' } },
			chatHref: null
		});
		// Nobody has reported the walls as done, so the confirmer has nothing to confirm yet.
		expect(await open(sessionFor(headTeacher), '?milestone=m2-walls')).toMatchObject({
			due: { kind: 'nothing', why: 'waiting', milestone: { part: 'confirms' } },
			chatHref: null
		});
	});
});

describe('a reminder that names no milestone', () => {
	it('is the work log for someone doing the work, with the milestone they owe next listed', async () => {
		const sent = await open(sessionFor(contractor));

		expect(sent).toMatchObject({
			due: { kind: 'work_log', alsoDue: walls },
			chatHref: '/chat',
			alsoDueHref: '/reminder?milestone=m2-walls'
		});
		expectNothingPrivate(sent, contractor);
	});

	it('is still the work log while their milestone waits for its confirmer', async () => {
		expect(await open(sessionFor(supplier))).toMatchObject({
			due: { kind: 'work_log', alsoDue: null },
			chatHref: '/chat',
			alsoDueHref: null
		});
	});

	it('shows a confirmer the milestone waiting on them, since they file no work logs', async () => {
		expect(await open(sessionFor(headTeacher), '?milestone=')).toMatchObject({
			due: { kind: 'milestone', milestone: { id: 'm3-books-delivered', step: 'confirm' } },
			chatHref: '/chat?milestone=m3-books-delivered'
		});
	});

	it('says nothing is due once everything of theirs is confirmed', async () => {
		await test.db
			.update(milestones)
			.set({ state: 'confirmed_independent', confirmedAt: '2026-11-13T10:00:00.000Z' })
			.where(eq(milestones.campaignId, fixtures.campaign.id));

		for (const party of [contractor, headTeacher]) {
			expect(await open(sessionFor(party))).toMatchObject({
				due: { kind: 'nothing', why: 'none_due' },
				chatHref: null
			});
		}
	});
});
