// Calls the proof page's own load against a real, migrated, seeded database. Nothing here
// reaches the network.
import { isHttpError } from '@sveltejs/kit';
import {
	agentWalletHostnameSchema,
	EVIDENCE_LEFT_OUT_SENTENCES,
	primaryWalletHostnameSchema
} from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaigns,
	claimDepositsForRefund,
	deposits,
	entries,
	evidenceFiles,
	linkPartyWallets,
	markRefundFailed,
	markRefundUnknown,
	milestones,
	parties
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { load } from './+page.server.ts';

const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

// The evidence store is the App, which is also where the sign-in callback is.
const APP = 'http://localhost:5174';

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test.destroy());

async function proof(entryId: string, campaignId: string = CAMPAIGN) {
	const config = { OIDC_REDIRECT_URI: `${APP}/auth/callback` };
	const event = { params: { campaignId, entryId }, locals: { ctx: { db: test.db, config } } };
	const data = await load(event as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('the load returned nothing');
	return data;
}

async function notFound(entryId: string, campaignId: string = CAMPAIGN) {
	try {
		await proof(entryId, campaignId);
	} catch (thrown) {
		expect(isHttpError(thrown, 404)).toBe(true);
		return;
	}
	throw new Error('expected a not-found');
}

/** A file as the evidence upload would return it: stored under its own SHA-256. */
function stored(extension: 'jpg' | 'pdf', fill: string) {
	const sha256 = fill.repeat(64);
	return { url: `${APP}/evidence/${sha256}.${extension}`, sha256 };
}

/** Adds an entry with its deposit, the way the check-in endpoint saves one. */
async function addEntry(
	id: string,
	values: Pick<typeof entries.$inferInsert, 'inputs'> & Partial<typeof entries.$inferInsert>
) {
	await test.db.insert(entries).values({
		id,
		campaignId: CAMPAIGN,
		milestoneId: 'm2-walls',
		partyId: contractor.id,
		item: 'log_work',
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

describe('the proof page', () => {
	it('is not found for an unknown campaign or an unknown entry', async () => {
		await notFound('ent-m1-claim', 'no-such-campaign');
		await notFound('no-such-entry');
	});

	it('is not found for an entry that belongs to a different campaign', async () => {
		await test.db
			.insert(campaigns)
			.values({ ...fixtures.campaign, id: 'other-campaign', title: 'Another campaign' });

		await notFound('ent-m1-claim', 'other-campaign');
	});

	it('shows a verified entry with its receipt, matching wallets and returned deposit', async () => {
		const data = await proof('ent-m1-claim');

		expect(data.entry).toMatchObject({ status: 'verified', statusReason: null });
		expect(data.receipt).toEqual({
			twistId: '41b1b59a1c45c4ef28d1b10ea119c174c9ebae1fbf624c5809f776659e905b6417',
			stampedAt: '2026-10-29T15:12:31.000Z',
			payingWallet: contractor.agentWalletHostname,
			registeredWallet: contractor.agentWalletHostname,
			walletsMatch: true
		});
		expect(data.deposit).toEqual({
			entryId: 'ent-m1-claim',
			amount: 1000,
			state: 'refunded',
			label: 'Deposit refunded',
			refund: 'returned',
			refundedAt: '2026-10-30T09:45:00.000Z',
			outstandingReason: null,
			outstandingMeaning: null
		});
		expect(data.filer).toEqual({
			name: 'Coral Ridge Builders',
			title: 'Contractor',
			role: 'third_party',
			relationship: 'participant',
			relationshipReason: null
		});
		expect(data.milestone).toMatchObject({ id: 'm1-foundation', confirmed: true });
	});

	it('shows every input of a milestone hit, with the ones not given as null', async () => {
		const { filed } = await proof('ent-m3-delivery');

		expect(filed).toEqual({
			item: 'milestone_hit',
			claim: 'delivered',
			summary:
				'First shipment of reading books delivered to the school office and signed for by the secretary.',
			quantity: null,
			unit: null,
			amountSpent: null,
			location: 'Mangrove Bay Primary School, front office'
		});
	});

	it('shows every input of a work log', async () => {
		const { filed } = await proof('ent-m2-log-2');

		expect(filed).toMatchObject({
			item: 'log_work',
			status: 'delayed',
			period: 'Week of 9 November',
			percentComplete: 35,
			location: 'Mangrove Bay Primary School, library wing'
		});
	});

	it('shows a filed entry as having no receipt yet, with its deposit held', async () => {
		const data = await proof('ent-m2-log-2');

		expect(data.entry.status).toBe('filed');
		expect(data.receipt).toEqual({
			twistId: null,
			stampedAt: null,
			payingWallet: null,
			registeredWallet: contractor.agentWalletHostname,
			walletsMatch: null
		});
		expect(data.deposit).toEqual({
			entryId: 'ent-m2-log-2',
			amount: 100,
			state: 'held',
			label: 'Deposit held',
			refund: 'held',
			refundedAt: null,
			outstandingReason: null,
			outstandingMeaning: null
		});
		expect(data.milestone.confirmed).toBe(false);
	});

	it('shows an incomplete entry with its reason', async () => {
		const data = await proof('ent-m3-delivery');

		expect(data.entry).toMatchObject({
			status: 'incomplete',
			statusReason: 'A delivery needs a quantity and a unit.'
		});
		expect(data.receipt.twistId).toBeNull();
	});

	it('shows a flagged entry with its reason and wallets that do not match', async () => {
		const data = await proof('ent-m2-log-1');

		expect(data.entry).toMatchObject({
			status: 'flagged',
			statusReason:
				'The deposit was paid from a wallet that is not the one registered for Coral Ridge Builders.'
		});
		expect(data.receipt).toMatchObject({
			payingWallet: 'unregistered-wallet.wallets.tejido.example',
			registeredWallet: contractor.agentWalletHostname,
			walletsMatch: false
		});
		expect(data.deposit?.refund).toBe('held');
	});

	it('compares with the wallet registered now, even on an entry verified earlier', async () => {
		await linkPartyWallets(test.db, contractor.id, {
			agentWalletHostname: agentWalletHostnameSchema.parse('new-agent.wallets.tejido.example'),
			primaryWalletHostname: primaryWalletHostnameSchema.parse('new.wallets.tejido.example')
		});

		const { entry, receipt } = await proof('ent-m1-claim');

		expect(entry.status).toBe('verified');
		expect(receipt.registeredWallet).toBe('new-agent.wallets.tejido.example');
		expect(receipt.walletsMatch).toBe(false);
	});

	it('says no wallet is registered for a party who has not signed in', async () => {
		await test.db.update(parties).set({ agentWalletHostname: null, primaryWalletHostname: null });

		const { receipt } = await proof('ent-m2-log-2');

		expect(receipt.registeredWallet).toBeNull();
		expect(receipt.walletsMatch).toBeNull();
	});

	it('says when a refund was started or its outcome is unknown', async () => {
		const refund = {
			id: 'refund-1',
			campaignId: CAMPAIGN,
			milestoneId: 'm2-walls',
			partyId: contractor.id,
			primaryWalletHostname: contractor.primaryWalletHostname!,
			dq: 'a'.repeat(64),
			amount: 100,
			status: 'started' as const,
			statusReason: null,
			startedAt: '2026-11-14T12:00:00.000Z',
			settledAt: null
		};
		expect(await claimDepositsForRefund(test.db, refund, ['dep-m2-log-2'])).toBe(true);
		expect((await proof('ent-m2-log-2')).deposit).toMatchObject({
			refund: 'being_returned',
			state: 'refund_outstanding',
			label: 'Refund outstanding',
			outstandingReason: 'in_progress'
		});

		await markRefundUnknown(test.db, refund.id, 'The transfer timed out.');
		expect((await proof('ent-m2-log-2')).deposit).toMatchObject({
			refund: 'outcome_unknown',
			state: 'refund_outstanding',
			label: 'Refund outstanding',
			outstandingReason: 'outcome_unknown',
			refundedAt: null
		});
		// The other deposit on the same milestone is untouched.
		expect((await proof('ent-m2-log-1')).deposit).toMatchObject({ refund: 'held', state: 'held' });
	});

	it('calls a deposit on a confirmed milestone a refund outstanding, and says why', async () => {
		await test.db
			.update(milestones)
			.set({ state: 'confirmed_independent', confirmedAt: '2026-11-14T09:00:00.000Z' })
			.where(eq(milestones.id, 'm2-walls'));

		// Flagged: not sent back until a person has looked. No refund is promised.
		expect((await proof('ent-m2-log-1')).deposit).toMatchObject({
			state: 'refund_outstanding',
			label: 'Refund outstanding',
			outstandingReason: 'entry_flagged',
			outstandingMeaning: expect.stringContaining('until a person has looked'),
			refund: 'held'
		});
		// Not matched to the ledger yet.
		expect((await proof('ent-m2-log-2')).deposit).toMatchObject({
			state: 'refund_outstanding',
			outstandingReason: 'entry_not_verified'
		});
	});

	it('remembers that a refund was refused, and still does not call the deposit refunded', async () => {
		await test.db
			.update(milestones)
			.set({ state: 'confirmed_independent', confirmedAt: '2026-11-14T09:00:00.000Z' })
			.where(eq(milestones.id, 'm2-walls'));
		await test.db
			.update(entries)
			.set({ status: 'verified', twistId: 'twist-m2-log-2' })
			.where(eq(entries.id, 'ent-m2-log-2'));
		expect((await proof('ent-m2-log-2')).deposit?.outstandingReason).toBe('not_attempted');

		const refund = {
			id: 'refund-refused',
			campaignId: CAMPAIGN,
			milestoneId: 'm2-walls',
			partyId: contractor.id,
			primaryWalletHostname: contractor.primaryWalletHostname!,
			dq: 'a'.repeat(64),
			amount: 100,
			status: 'started' as const,
			statusReason: null,
			startedAt: '2026-11-14T12:00:00.000Z',
			settledAt: null
		};
		await claimDepositsForRefund(test.db, refund, ['dep-m2-log-2']);
		await markRefundFailed(test.db, refund.id, 'Qatom said 402', '2026-11-14T12:00:05.000Z');

		expect((await proof('ent-m2-log-2')).deposit).toMatchObject({
			state: 'refund_outstanding',
			label: 'Refund outstanding',
			outstandingReason: 'refused',
			refundedAt: null
		});
	});

	it('shows a file from our evidence store with its full SHA-256', async () => {
		const photo = { ...stored('jpg', 'a'), caption: 'East wall' };
		const document = stored('pdf', 'b');
		await addEntry('ent-good', {
			inputs: {
				reporter_code: contractor.reporterCode,
				milestone_id: 'm2-walls',
				summary: 'East wall at lintel height.',
				photos: [photo, document]
			}
		});

		const { evidence } = await proof('ent-good');

		expect(evidence).toEqual([
			{
				state: 'shown',
				kind: 'photo',
				url: photo.url,
				sha256: 'a'.repeat(64),
				caption: 'East wall'
			},
			{
				state: 'shown',
				kind: 'document',
				url: document.url,
				sha256: 'b'.repeat(64),
				caption: null
			}
		]);
	});

	it('says what a not-public file is and why, with its SHA-256 and without its address', async () => {
		const photo = stored('jpg', 'a');
		const classList = { ...stored('pdf', 'b'), caption: 'Form 3: every pupil by name' };
		await addEntry('ent-private', {
			inputs: {
				reporter_code: contractor.reporterCode,
				milestone_id: 'm2-walls',
				summary: 'Books handed to form 3.',
				photos: [photo, classList]
			}
		});
		await test.db.insert(evidenceFiles).values({
			sha256: classList.sha256,
			uploadedByPartyId: contractor.id,
			visibility: 'not_public',
			notPublicKind: 'Class list',
			notPublicReason: 'It has pupils’ names on it.',
			createdAt: '2026-11-14T08:00:00.000Z',
			updatedAt: '2026-11-14T08:00:00.000Z'
		});

		const data = await proof('ent-private');

		expect(data.evidence).toEqual([
			{ state: 'shown', kind: 'photo', url: photo.url, sha256: photo.sha256, caption: null },
			{
				state: 'not_public',
				kind: 'Class list',
				reason: 'It has pupils’ names on it.',
				sha256: classList.sha256
			}
		]);
		const sent = JSON.stringify(data);
		expect(sent).not.toContain(classList.url);
		expect(sent).not.toContain(`${classList.sha256}.pdf`);
		expect(sent).not.toContain('every pupil by name');
	});

	it('leaves out a file that is not in our store, or whose hash is not its own', async () => {
		await addEntry('ent-bad', {
			status: 'incomplete',
			statusReason: 'Photo 1 is not a file from the Tejido evidence upload.',
			inputs: {
				reporter_code: contractor.reporterCode,
				milestone_id: 'm2-walls',
				summary: 'East wall at lintel height.',
				photos: [
					{ url: 'https://elsewhere.example/evidence/photo.jpg', sha256: 'c'.repeat(64) },
					{ url: stored('jpg', 'd').url, sha256: 'e'.repeat(64) }
				]
			}
		});

		const { evidence } = await proof('ent-bad');

		expect(evidence).toEqual([
			{
				state: 'left_out',
				reason: 'not_in_our_store',
				sentence: EVIDENCE_LEFT_OUT_SENTENCES.not_in_our_store,
				sha256: 'c'.repeat(64)
			},
			{
				state: 'left_out',
				reason: 'hash_mismatch',
				sentence: EVIDENCE_LEFT_OUT_SENTENCES.hash_mismatch,
				sha256: 'e'.repeat(64)
			}
		]);
		expect(JSON.stringify(evidence)).not.toContain('elsewhere.example');
	});

	it('leaves out the seeded example files, which are not in the evidence store', async () => {
		const { evidence } = await proof('ent-m1-claim');

		expect(evidence.map((file: { state: string }) => file.state)).toEqual(['left_out', 'left_out']);
	});

	it('leaves out a picture on a documents-only milestone, and keeps the document', async () => {
		await test.db.insert(milestones).values({
			campaignId: CAMPAIGN,
			id: 'm4-fees',
			position: 4,
			title: 'School fees paid',
			description: '',
			kind: 'funds_handover',
			ownerPartyId: supplier.id,
			confirmerPartyId: headTeacher.id,
			dueDate: '2026-12-18',
			state: 'open',
			confirmedAt: null
		});
		await addEntry('ent-fees', {
			milestoneId: 'm4-fees',
			partyId: supplier.id,
			item: 'milestone_hit',
			status: 'incomplete',
			statusReason: 'A funds handover milestone takes documents only.',
			inputs: {
				reporter_code: supplier.reporterCode,
				milestone_id: 'm4-fees',
				claim: 'funds_spent',
				summary: 'Term fees paid to the school.',
				amount_spent: 250,
				photos: [stored('jpg', 'a'), stored('pdf', 'b')]
			}
		});

		const data = await proof('ent-fees');

		expect(data.documentsOnly).toBe(true);
		expect(data.evidence).toEqual([
			{
				state: 'left_out',
				reason: 'picture_on_documents_only',
				sentence: EVIDENCE_LEFT_OUT_SENTENCES.picture_on_documents_only,
				sha256: 'a'.repeat(64)
			},
			{
				state: 'shown',
				kind: 'document',
				url: stored('pdf', 'b').url,
				sha256: 'b'.repeat(64),
				caption: null
			}
		]);
		expect(data.filed).toMatchObject({ claim: 'funds_spent', amountSpent: 250 });
	});

	it('sends no reporter code, email address or primary wallet to the page', async () => {
		for (const entry of fixtures.entries) {
			const sent = JSON.stringify(await proof(entry.id));

			expect(sent).not.toContain('rc_');
			expect(sent).not.toContain('@');
			expect(sent).not.toContain(fixtures.campaign.creatorEmail);
			for (const party of fixtures.parties) {
				expect(sent).not.toContain(party.reporterCode);
				expect(sent).not.toContain(party.email);
				expect(sent).not.toContain(party.primaryWalletHostname!);
			}
		}
	});
});
