// The invitation page's own load function, run against a real, migrated, seeded local D1.
// Anyone holding the link can open this page, so it must carry nothing private.
// Nothing reaches the network: `fetch` is replaced by a stub that fails the test if called.
import { isHttpError } from '@sveltejs/kit';
import { fixtures } from '@tejido/contracts/fixtures';
import { parties } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '#lib/server/session.ts';
import { load } from './+page.server.ts';

const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

let test: TestDatabase;
const fetchStub = vi.fn(() => Promise.reject(new Error('a test reached the network')));

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	vi.stubGlobal('fetch', fetchStub);
});

afterEach(async () => {
	expect(fetchStub).not.toHaveBeenCalled();
	vi.unstubAllGlobals();
	await test.destroy();
});

// A whole RequestEvent cannot be built outside SvelteKit; this load uses only these parts.
const invite = (partyId: string, session: Session | null = null) =>
	load({
		params: { partyId },
		locals: { ctx: { db: test.db }, session }
	} as unknown as Parameters<typeof load>[0]);

/** The invitation as a browser receives it. */
async function sent(partyId: string, session: Session | null = null) {
	const data = await invite(partyId, session);
	if (!data) throw new Error('expected the page data');
	return data;
}

function expectNothingPrivate(data: unknown) {
	const text = JSON.stringify(data);
	for (const party of fixtures.parties) {
		expect(text).not.toContain(party.reporterCode);
		expect(text).not.toContain(party.email);
		if (party.agentWalletHostname) expect(text).not.toContain(party.agentWalletHostname);
		if (party.primaryWalletHostname) expect(text).not.toContain(party.primaryWalletHostname);
	}
	expect(text).not.toContain(fixtures.campaign.creatorEmail);
	expect(text).not.toMatch(/token/i);
}

describe('the invitation page', () => {
	it('shows a contractor the project, their role and the milestones they report on', async () => {
		const data = await sent(contractor.id);
		expect(data).toEqual({
			header: { title: 'Invitation', subtitle: 'Tejido field app' },
			party: {
				id: contractor.id,
				name: contractor.name,
				title: 'Contractor',
				role: 'third_party',
				emailHint: 'm•••@todaq.net',
				// Someone who does the work is not given a confirmation strength.
				shownAs: null,
				walletsLinked: true
			},
			campaign: {
				title: fixtures.campaign.title,
				summary: fixtures.campaign.summary,
				beneficiary: fixtures.campaign.beneficiary,
				creatorName: fixtures.campaign.creatorName,
				cadence: 'weekly'
			},
			milestones: [
				{
					id: 'm1-foundation',
					position: 1,
					title: 'Foundation and floor slab',
					dueDate: '2026-10-30'
				},
				{ id: 'm2-walls', position: 2, title: 'Walls up to roof height', dueDate: '2026-11-27' }
			],
			signedInAsThisParty: false
		});
		expectNothingPrivate(data);
	});

	it('shows a supplier only their own milestone', async () => {
		const data = await sent(supplier.id);
		expect(data.milestones.map((milestone: { id: string }) => milestone.id)).toEqual([
			'm3-books-delivered'
		]);
		expectNothingPrivate(data);
	});

	it('shows a confirmer the milestones they confirm and how donors will see them', async () => {
		const data = await sent(headTeacher.id);
		expect(data.party.shownAs).toEqual({
			relationship: 'stakeholder',
			reason: 'Head teacher of the school whose library is being rebuilt.'
		});
		expect(data.milestones.map((milestone: { id: string }) => milestone.id)).toEqual([
			'm1-foundation',
			'm2-walls',
			'm3-books-delivered'
		]);
		expectNothingPrivate(data);
	});

	it('shows a confirmer whose relationship nobody recorded as stakeholder, never independent', async () => {
		await test.db
			.update(parties)
			.set({ relationship: null, relationshipReason: null })
			.where(eq(parties.id, headTeacher.id));
		expect((await sent(headTeacher.id)).party.shownAs).toEqual({
			relationship: 'stakeholder',
			reason: null
		});
	});

	it('shows independent only when that is what was recorded', async () => {
		await test.db
			.update(parties)
			.set({ relationship: 'independent', relationshipReason: 'Employed by the parish council.' })
			.where(eq(parties.id, headTeacher.id));
		expect((await sent(headTeacher.id)).party.shownAs).toEqual({
			relationship: 'independent',
			reason: 'Employed by the parish council.'
		});
	});

	it('knows when the person looking is already signed in on this invitation', async () => {
		const session: Session = { sub: 'u1', email: contractor.email, partyId: contractor.id };
		expect((await sent(contractor.id, session)).signedInAsThisParty).toBe(true);
		// Signed in as someone else: this invitation is not theirs.
		const data = await sent(supplier.id, session);
		expect(data.signedInAsThisParty).toBe(false);
		expectNothingPrivate(data);
	});

	it('says when the wallets are not linked yet', async () => {
		await test.db
			.update(parties)
			.set({ agentWalletHostname: null, primaryWalletHostname: null })
			.where(eq(parties.id, contractor.id));
		expect((await sent(contractor.id)).party.walletsLinked).toBe(false);
	});

	it('answers an invitation it does not know with a page that says what to do', async () => {
		const thrown = await Promise.resolve()
			.then(() => invite('nobody'))
			.then(
				() => null,
				(error: unknown) => error
			);
		expect(isHttpError(thrown, 404)).toBe(true);
		if (isHttpError(thrown))
			expect(thrown.body.message).toContain('We do not recognise this invite');
	});
});
