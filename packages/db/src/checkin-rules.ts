/**
 * The rules of a check-in that a schema cannot express. Track C owns this file.
 *
 * It lives in this package, not in the Campaign Site, because two apps apply these rules and
 * the apps never import from each other: the check-in endpoint (apps/web) when an entry is
 * filed, and the App's "fix an incomplete entry" page (apps/app) when evidence is added later.
 * apps/web/src/lib/server/backend/checkin-rules.ts passes these on under its old path.
 *
 * `decideCheckin` reads nothing and writes nothing: given who filed, on which milestone and
 * with what inputs, it says whether the entry is refused, saved as `filed` or saved as
 * `incomplete`, and whether the milestone moves to a new state. The check-in endpoint calls
 * it; the reconciler and the refund job can rely on the state it leaves behind.
 *
 * By the time a check-in reaches us its deposit HAS BEEN PAID. So only two things are
 * refused: a party reporting on a milestone that is not theirs, and a confirmation from
 * anyone but the milestone's named confirmer. Every other gap is saved as `incomplete`, with
 * the reason, so the reporter can fix it without paying again.
 *
 * The rules come from docs/architecture.md: "Who confirms a milestone", "How two items cover
 * every party and milestone" and "Who enforces what".
 */
import {
	formatAmount,
	isConfirmed,
	type Amount,
	type CheckinInputs,
	type CheckinProblem,
	type CheckinRefusalReason,
	type Milestone,
	type MilestoneClaim,
	type MilestoneKind,
	type MilestoneState,
	type Party,
	type Timestamp
} from '@tejido/contracts';
import type { MilestoneAdvance } from './records.ts';
import { checkEvidence, type EvidenceVerdict } from './evidence.ts';

// ---------------------------------------------------------------------------
// What each kind of milestone asks for
// ---------------------------------------------------------------------------

interface KindRules {
	/** How the kind is named in a sentence: "A construction milestone ...". */
	label: string;
	/** The claim that says this kind of milestone is done. */
	claim: Exclude<MilestoneClaim, 'confirm'>;
	/** Documents only: no pictures may be attached to any entry on the milestone. */
	documentsOnly: boolean;
	/** A work log needs a percent complete, unless it reports that work is blocked. */
	workLogNeedsPercent: boolean;
}

/**
 * The brief's table of milestone types. Construction and goods are evidenced by photos.
 * Funds handovers and services are evidenced by documents (a receipt, an enrolment letter),
 * and take no photos: that is the rule that keeps pictures of a child off a campaign.
 */
const KIND_RULES: Record<MilestoneKind, KindRules> = {
	construction: {
		label: 'construction',
		claim: 'completed',
		documentsOnly: false,
		workLogNeedsPercent: true
	},
	goods_delivery: {
		label: 'goods delivery',
		claim: 'delivered',
		documentsOnly: false,
		workLogNeedsPercent: false
	},
	funds_handover: {
		label: 'funds handover',
		claim: 'funds_spent',
		documentsOnly: true,
		workLogNeedsPercent: false
	},
	service: {
		label: 'service',
		claim: 'completed',
		documentsOnly: true,
		workLogNeedsPercent: false
	}
};

/** Whether a milestone of this kind takes documents only, so no picture may be attached. */
export function takesDocumentsOnly(kind: MilestoneKind): boolean {
	return KIND_RULES[kind].documentsOnly;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface CheckinRefusal {
	httpStatus: number;
	error: CheckinRefusalReason;
	message: string;
	problems: CheckinProblem[];
}

export type CheckinDecision =
	| { allowed: false; refusal: CheckinRefusal }
	| {
			allowed: true;
			status: 'filed' | 'incomplete';
			/** What is still owed on this entry, one sentence each. Empty when it is `filed`. */
			owed: string[];
			/** `owed` as one text a donor can read, or null. Stored on the entry. */
			statusReason: string | null;
			/** The state change to save with the entry, or null when the state stays. */
			advance: MilestoneAdvance | null;
	  };

export interface CheckinFacts {
	checkin: CheckinInputs;
	/** The party the reporter code resolved to. */
	party: Party;
	/** The milestone named by `milestone_id`, in that party's campaign. */
	milestone: Milestone;
	/** The origin our evidence URLs are on. See `evidenceStoreOrigin`. */
	evidenceOrigin: string;
	now: Timestamp;
}

const STATUS_REASON_MAX = 500;

export function decideCheckin(facts: CheckinFacts): CheckinDecision {
	const { checkin, party, milestone, now } = facts;
	const kind = KIND_RULES[milestone.kind];
	const isConfirmation = checkin.item === 'milestone_hit' && checkin.inputs.claim === 'confirm';

	// 1. May this party file this on this milestone?
	const refusal = isConfirmation ? refuseConfirmation(party, milestone) : refuseReport(facts);
	if (refusal) return { allowed: false, refusal };

	// 2. What is missing? None of this refuses the entry: its deposit has been paid.
	const owed: string[] = [];
	const evidence = (checkin.inputs.photos ?? []).map((photo) =>
		checkEvidence(photo, facts.evidenceOrigin)
	);
	let advance: MilestoneAdvance | null = null;

	if (checkin.item === 'log_work') {
		const { status, percent_complete } = checkin.inputs;
		if (kind.workLogNeedsPercent && status !== 'blocked' && percent_complete === undefined) {
			owed.push(`A work log on a ${kind.label} milestone needs a percent complete.`);
		}
	} else if (isConfirmation) {
		// 3a. A confirmation moves a claimed milestone to confirmed. There must be a claim first.
		if (milestone.state === 'open') {
			owed.push('Nothing has been claimed on this milestone yet, so there is nothing to confirm.');
		} else if (milestone.state === 'claimed') {
			advance = { from: 'claimed', to: 'confirmed_independent', confirmedAt: now };
		}
	} else {
		const { claim, quantity, unit, amount_spent } = checkin.inputs;
		if (claim !== kind.claim) {
			owed.push(`A ${kind.label} milestone is claimed with "${kind.claim}", not "${claim}".`);
		}
		if (milestone.kind === 'goods_delivery' && (quantity === undefined || !unit)) {
			owed.push('A delivery needs a quantity and a unit.');
		}
		if (milestone.kind === 'funds_handover' && amount_spent === undefined) {
			owed.push('A funds handover needs the amount spent.');
		}
		if (kind.documentsOnly) {
			if (!evidence.includes('document')) {
				owed.push(
					milestone.kind === 'funds_handover'
						? 'A funds handover needs a receipt, uploaded as a document (PDF).'
						: `A ${kind.label} claim needs at least one document (PDF).`
				);
			}
		} else if (!evidence.includes('photo')) {
			owed.push(`A ${kind.label} claim needs at least one photo.`);
		}
		// 3b. A claim by the owner moves an open milestone to claimed, complete or not.
		if (milestone.state === 'open') {
			advance = { from: 'open', to: 'claimed', confirmedAt: null };
		}
	}

	// 4. The evidence rules hold for every entry, whatever was bought.
	owed.push(...evidenceProblems(evidence, kind));

	if (owed.length === 0)
		return { allowed: true, status: 'filed', owed, statusReason: null, advance };
	return {
		allowed: true,
		status: 'incomplete',
		owed,
		statusReason: fit(owed.join(' '), STATUS_REASON_MAX),
		advance
	};
}

/** A confirmation only counts from the milestone's named confirmer, and never from its owner. */
function refuseConfirmation(party: Party, milestone: Milestone): CheckinRefusal | null {
	if (party.id === milestone.ownerPartyId) {
		return notAllowed(
			'claim',
			`Refused: you cannot confirm "${milestone.title}" yourself. A milestone is confirmed by a second party, not the one doing the work.`,
			'a milestone cannot be confirmed by the party who owes it'
		);
	}
	if (party.id !== milestone.confirmerPartyId) {
		return notAllowed(
			'claim',
			`Refused: only the confirmer named for "${milestone.title}" can confirm it.`,
			'only the confirmer named for this milestone can confirm it'
		);
	}
	return null;
}

/** Work logs and claims come only from the party who owes the milestone. */
function refuseReport({ checkin, party, milestone }: CheckinFacts): CheckinRefusal | null {
	if (party.id === milestone.ownerPartyId) return null;

	if (checkin.item === 'milestone_hit' && party.id === milestone.confirmerPartyId) {
		return notAllowed(
			'claim',
			`Refused: you are the confirmer for "${milestone.title}", so you cannot claim it. To sign it off, use claim "confirm".`,
			'the confirmer of a milestone cannot claim it; use "confirm"'
		);
	}
	return notAllowed(
		'milestone_id',
		`Refused: "${milestone.title}" is not your milestone. You can only report on a milestone you owe.`,
		'is a milestone that belongs to another party'
	);
}

/**
 * The contract has no refusal reason of its own for "not yours to file", so these are
 * reported as `invalid_inputs`, naming the input that is wrong for this party.
 */
function notAllowed(input: string, message: string, problem: string): CheckinRefusal {
	return { httpStatus: 422, error: 'invalid_inputs', message, problems: [{ input, problem }] };
}

function evidenceProblems(evidence: EvidenceVerdict[], kind: KindRules): string[] {
	const numbers = (verdict: EvidenceVerdict) =>
		evidence.flatMap((found, index) => (found === verdict ? [index + 1] : []));
	const problems: string[] = [];

	const foreign = numbers('foreign');
	if (foreign.length > 0) {
		problems.push(
			`Every file must come from the Tejido evidence upload: ${nth(foreign, 'does', 'do')} not. Upload each file and use the URL you are given.`
		);
	}
	const mismatched = numbers('hash_mismatch');
	if (mismatched.length > 0) {
		problems.push(
			`The SHA-256 given for ${nth(mismatched, 'is', 'are')} not the hash of the uploaded file.`
		);
	}
	const pictures = kind.documentsOnly ? numbers('photo') : [];
	if (pictures.length > 0) {
		problems.push(
			`A ${kind.label} milestone takes documents only (PDF), no photos: ${nth(pictures, 'is a picture', 'are pictures')}.`
		);
	}
	return problems;
}

/** "item 2 in photos is", "items 1 and 3 in photos are", "items 1, 2 and 4 in photos are". */
function nth(numbers: number[], one: string, many: string): string {
	if (numbers.length === 1) return `item ${numbers[0]} in photos ${one}`;
	return `items ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)} in photos ${many}`;
}

function fit(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

export interface AcceptedFacts {
	checkin: CheckinInputs;
	party: Party;
	milestone: Milestone;
	status: 'filed' | 'incomplete';
	owed: string[];
	/** The milestone's state once the entry is saved. */
	state: MilestoneState;
	/** True when this entry is what moved the milestone to `state`. */
	advanced: boolean;
	/** For a work log: which one this is for the party on the milestone, counting from 1. */
	workLogNumber: number;
	/** The name of the milestone's confirmer. */
	confirmerName: string;
	deposit: Amount;
}

/**
 * The message that travels back through Qatom and becomes the agent's tool result. It says
 * what was saved, what is still owed on the entry, and what the milestone waits for next.
 */
export function describeAccepted(facts: AcceptedFacts): string {
	const { checkin, party, milestone, status, owed, state, deposit } = facts;
	const title = `"${milestone.title}"`;
	const isConfirmation = checkin.item === 'milestone_hit' && checkin.inputs.claim === 'confirm';
	const sentences: string[] = [];

	const what =
		checkin.item === 'log_work'
			? `work log ${facts.workLogNumber}`
			: isConfirmation
				? 'confirmation'
				: `milestone claim (${checkin.inputs.claim})`;
	if (status === 'filed') {
		sentences.push(`Accepted: ${what} for ${title} filed by ${party.name}.`);
	} else {
		sentences.push(
			`Accepted but incomplete: ${what} for ${title} was saved for ${party.name}. Still owed: ${owed.join(' ')}`
		);
		// A confirmation with nothing to confirm cannot be completed later; it has to be filed again.
		sentences.push(
			isConfirmation && state === 'open'
				? `Confirm again once ${title} has been claimed.`
				: 'Add what is missing on Tejido; you do not pay again.'
		);
	}

	if (checkin.item === 'log_work' && checkin.inputs.percent_complete !== undefined) {
		sentences.push(`Reported ${checkin.inputs.percent_complete}% complete.`);
	}

	if (isConfirmed({ state })) {
		sentences.push(
			facts.advanced
				? `${title} is now confirmed independently. The deposits paid on it are due back to each filer's primary wallet.`
				: `${title} was already confirmed.`
		);
		return sentences.join(' ');
	}

	if (checkin.item === 'log_work') {
		sentences.push(`The milestone is due ${milestone.dueDate}.`);
	} else if (state === 'claimed') {
		sentences.push(`${title} is claimed and awaits confirmation by ${facts.confirmerName}.`);
	}
	sentences.push(
		`The ${formatAmount(deposit)} deposit is returned when the milestone is confirmed.`
	);
	return sentences.join(' ');
}
