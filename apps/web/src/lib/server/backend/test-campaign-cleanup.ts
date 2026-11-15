/**
 * Removing the campaigns the automatic end-to-end tests leave behind, by themselves on the
 * timer. Track C owns this file.
 *
 * THIS DELETES DATA FROM THE DATABASE, WITH NOBODY WATCHING (the owner, 15 November 2026:
 * "We should clean up automated test campaigns"). Every paid run of the tests creates a
 * campaign of its own through the campaign API; nothing else removes them.
 *
 * WHICH CAMPAIGNS. The whole rule is `decide` below, and nothing a caller sends is part of
 * it. A campaign is deleted only when ALL of these hold:
 *
 *   1. THE TESTS OWN IT. Its creator's email is at the test inbox domain, and so is the
 *      email of EVERY person on it. `isEndToEndTestEmail` in @tejido/qatom is the one place
 *      that decides who is a test person; it is asked here about every address of every
 *      campaign considered. The database only shortens the list.
 *   2. IT IS NOT THE FIXED TEST CAMPAIGN (`E2E_CAMPAIGN_ID`), which every run uses. That one
 *      is never deleted, at any age: it is not listed, it is refused here, and the delete
 *      itself throws on its id (packages/db/src/test-campaigns.ts).
 *   3. IT IS OLD ENOUGH: created at least MIN_AGE_MS ago, so the run that made it and the
 *      refunds of its deposits are over.
 *   4. ITS MONEY IS FINISHED: no deposit waits for a refund, no refund is `started` or
 *      `unknown`, and it has no donation. If not, the campaign is LEFT ALONE and counted
 *      with the reason, so the refund passes can still do their work and a person can look.
 *      Once it is FORCE_AGE_MS old it is deleted anyway, and what was left unrefunded is
 *      counted.
 *
 * AT MOST PASS_LIMIT campaigns are deleted in one pass, oldest first. The rest wait for the
 * next pass, a minute later.
 *
 * WHAT IS DELETED: every row that belongs to the campaign, in every table, all or nothing
 * (see packages/db/src/test-campaigns.ts). NO STORED EVIDENCE BYTES ARE DELETED: this app has
 * no binding to the evidence store. The files left behind are counted.
 *
 * Nothing here calls Qatom or moves money.
 */
import {
	deleteCampaignAndAllOfItsOwn,
	E2E_CAMPAIGN_ID,
	listCleanupCandidates,
	type CleanupCandidate,
	type Database
} from '@tejido/db';
import { E2E_TEST_EMAIL_DOMAIN, isEndToEndTestEmail } from '@tejido/qatom/account';

/**
 * How old a test campaign must be before it is deleted: 2 hours. A refund of a test deposit
 * can take 20 minutes and the undoing of a test donation up to 60. Do not lower it.
 */
export const MIN_AGE_MS = 2 * 60 * 60_000;

/** A test campaign this old is deleted even if its money is not finished: 24 hours. */
export const FORCE_AGE_MS = 24 * 60 * 60_000;

/** The most campaigns one pass deletes. */
export const PASS_LIMIT = 5;

/** The most deletions one pass tries, counting the ones the database refuses. */
const TRIES_PER_PASS = PASS_LIMIT * 2;

export type CleanupLeftReason =
	/** The fixed test campaign. Never deleted. */
	| 'fixed_test_campaign'
	/** The creator's address is not a test person's. Not the tests' campaign: never deleted. */
	| 'creator_not_a_test_person'
	/** Somebody on it is not a test person. Never deleted. */
	| 'has_other_people'
	/** Created less than MIN_AGE_MS ago, or at a time that cannot be read. */
	| 'not_old_enough'
	/** A refund's transfer got no answer. Waits until FORCE_AGE_MS. */
	| 'refund_outcome_unknown'
	/** A refund was started and has no recorded outcome. Waits until FORCE_AGE_MS. */
	| 'refund_in_progress'
	/** A deposit has not been refunded. Waits until FORCE_AGE_MS. */
	| 'deposit_not_refunded'
	/** It has a donation that has not been undone. Waits until FORCE_AGE_MS. */
	| 'donation_not_undone'
	/** This pass has deleted as many as one pass may. Waits for the next pass. */
	| 'pass_limit_reached'
	/** A file one of its people uploaded is named by somebody else's entry elsewhere. */
	| 'evidence_named_by_someone_else'
	/** The database refused the deletion. Nothing was removed. */
	| 'could_not_delete';

/** Reasons that no later pass will clear by itself: someone has to look. */
const NEEDS_A_PERSON: ReadonlySet<CleanupLeftReason> = new Set([
	'creator_not_a_test_person',
	'has_other_people',
	'evidence_named_by_someone_else',
	'could_not_delete'
]);

export type CleanupDecision =
	| { delete: false; reason: CleanupLeftReason }
	/** `moneyNotFinished` is true only for a campaign past FORCE_AGE_MS. */
	| { delete: true; moneyNotFinished: boolean };

/**
 * THE RULE: whether one campaign may be deleted now. Pure: it reads nothing but what it is
 * given. Anything it is unsure of is a reason to leave the campaign.
 */
export function decide(campaign: CleanupCandidate, now: Date): CleanupDecision {
	const leave = (reason: CleanupLeftReason): CleanupDecision => ({ delete: false, reason });

	// 2. Never the fixed test campaign, whatever else is true of it.
	if (campaign.id === E2E_CAMPAIGN_ID) return leave('fixed_test_campaign');

	// 1. The tests own it: its creator, and everybody on it.
	if (!isEndToEndTestEmail(campaign.creatorEmail)) return leave('creator_not_a_test_person');
	if (!campaign.partyEmails.every((email) => isEndToEndTestEmail(email))) {
		return leave('has_other_people');
	}

	// 3. Old enough. A time that cannot be read is not old enough.
	const age = now.getTime() - Date.parse(campaign.createdAt);
	if (!(age >= MIN_AGE_MS)) return leave('not_old_enough');

	// 4. Its money is finished, or it is so old that it goes anyway.
	const waitingFor: CleanupLeftReason | null =
		campaign.refundsOutcomeUnknown > 0
			? 'refund_outcome_unknown'
			: campaign.refundsInProgress > 0
				? 'refund_in_progress'
				: campaign.depositsNotRefunded > 0
					? 'deposit_not_refunded'
					: campaign.donations > 0
						? 'donation_not_undone'
						: null;
	if (waitingFor === null) return { delete: true, moneyNotFinished: false };
	if (age >= FORCE_AGE_MS) return { delete: true, moneyNotFinished: true };
	return leave(waitingFor);
}

export interface CleanupDeleted {
	campaign_id: string;
	/** True when it was deleted at FORCE_AGE_MS with money not finished. */
	money_not_finished: boolean;
	/** Deposits that had not been refunded when it was deleted. */
	deposits_not_refunded: number;
	/** Donations that had not been undone when it was deleted. */
	donations_not_undone: number;
	/** Files whose bytes are still in the evidence store, named by nothing any more. */
	evidence_files_left_in_store: number;
	/** Files still named by another campaign, handed to the same test person there. */
	evidence_files_handed_over: number;
}

export interface CleanupLeft {
	campaign_id: string;
	reason: CleanupLeftReason;
}

export interface CleanupReport {
	deleted: CleanupDeleted[];
	left: CleanupLeft[];
	/** True when something was left that only a person can resolve. */
	needs_a_person: boolean;
	message: string;
}

export interface CleanUpTestCampaignsOptions {
	db: Database;
	/** The moment the pass runs. Only tests give one. */
	now?: Date;
}

/**
 * One pass: deletes up to PASS_LIMIT campaigns the tests own and are finished with, oldest
 * first. Safe to run again: a second pass finds what the first left.
 */
export async function cleanUpTestCampaigns(
	options: CleanUpTestCampaignsOptions
): Promise<CleanupReport> {
	const { db } = options;
	const now = options.now ?? new Date();

	// The database shortens the list: creator at the test domain, not the fixed campaign,
	// old enough. `decide` then judges each one again, in code.
	const candidates = await listCleanupCandidates(
		db,
		E2E_TEST_EMAIL_DOMAIN,
		new Date(now.getTime() - MIN_AGE_MS).toISOString()
	);

	const deleted: CleanupDeleted[] = [];
	const left: CleanupLeft[] = [];
	let tries = 0;
	for (const campaign of candidates) {
		const decision = decide(campaign, now);
		if (!decision.delete) {
			left.push({ campaign_id: campaign.id, reason: decision.reason });
			continue;
		}
		if (deleted.length >= PASS_LIMIT || tries >= TRIES_PER_PASS) {
			left.push({ campaign_id: campaign.id, reason: 'pass_limit_reached' });
			continue;
		}

		tries += 1;
		let outcome;
		try {
			outcome = await deleteCampaignAndAllOfItsOwn(db, campaign.id);
		} catch (error) {
			// The batch is all or nothing: the campaign is exactly as it was. Only the kind of
			// failure is logged; a database error can quote a row.
			console.error(
				'Test-campaign cleanup: a deletion was refused:',
				error instanceof Error ? error.name : 'Unknown failure'
			);
			left.push({ campaign_id: campaign.id, reason: 'could_not_delete' });
			continue;
		}
		// Another pass removed it first: there is nothing to say about it.
		if (!outcome.deleted && outcome.why === 'not_found') continue;
		if (!outcome.deleted) {
			left.push({ campaign_id: campaign.id, reason: outcome.why });
			continue;
		}
		deleted.push({
			campaign_id: campaign.id,
			money_not_finished: decision.moneyNotFinished,
			deposits_not_refunded: campaign.depositsNotRefunded,
			donations_not_undone: campaign.donations,
			evidence_files_left_in_store: outcome.evidenceRowsDeleted,
			evidence_files_handed_over: outcome.evidenceRowsHandedOver
		});
	}

	const needsAPerson = left.some(({ reason }) => NEEDS_A_PERSON.has(reason));
	const plural = (n: number) => `${n} test campaign${n === 1 ? '' : 's'}`;
	const parts = [
		deleted.length === 0 ? 'Nothing was deleted.' : `Deleted ${plural(deleted.length)}.`
	];
	if (left.length > 0) parts.push(`Left ${plural(left.length)} alone.`);
	if (needsAPerson) parts.push('A person needs to look at some of the ones left.');

	return { deleted, left, needs_a_person: needsAPerson, message: parts.join(' ') };
}

/**
 * One plain line about a pass, for the Worker's logs, or null when the pass had nothing to
 * consider.
 *
 * Counts and reason names only. Never an email, a wallet, an id or a title: the line is built
 * from the numbers in the report and from `reason`, which is one of a fixed set of names, and
 * from nothing else.
 */
export function cleanupLogLine(report: CleanupReport): string | null {
	if (report.deleted.length === 0 && report.left.length === 0) return null;

	const byReason = new Map<CleanupLeftReason, number>();
	for (const { reason } of report.left) byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
	const reasons = [...byReason]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([reason, count]) => `${reason} ${count}`)
		.join(', ');

	const sum = (pick: (line: CleanupDeleted) => number) =>
		report.deleted.reduce((total, line) => total + pick(line), 0);
	const unfinished = report.deleted.filter((line) => line.money_not_finished);
	const unfinishedSum = (pick: (line: CleanupDeleted) => number) =>
		unfinished.reduce((total, line) => total + pick(line), 0);

	return [
		`Test-campaign cleanup: ${report.deleted.length} deleted`,
		`${unfinished.length} of them with money not finished (${unfinishedSum((line) => line.deposits_not_refunded)} deposits not refunded, ${unfinishedSum((line) => line.donations_not_undone)} donations not undone)`,
		`${report.left.length} left${reasons === '' ? '' : ` (${reasons})`}`,
		`evidence files left in the store: ${sum((line) => line.evidence_files_left_in_store)}`,
		`a person needs to look: ${report.needs_a_person ? 'YES' : 'no'}.`
	].join(', ');
}
