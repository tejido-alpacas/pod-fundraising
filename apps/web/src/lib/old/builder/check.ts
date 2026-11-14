/**
 * Checks a builder draft against the contracts and says what is wrong in plain words.
 *
 * Every limit and every allowed value comes from @tejido/contracts: this file adds words, and
 * the few rules that are about a whole campaign rather than one field (who may confirm what).
 * The server runs it on every step and again before creating anything; the page runs
 * `noticesFor` to show the organiser what donors will see.
 */
import {
	AMOUNT_UNITS_PER_USD_TDN,
	cadenceSchema,
	campaignSchema,
	milestoneKindSchema,
	milestoneSchema,
	partyRelationshipSchema,
	partySchema,
	type Amount,
	type Cadence,
	type MilestoneKind,
	type PartyRelationship,
	type PartyRole
} from '@tejido/contracts';
import type { z } from 'zod';
import {
	MAX_MILESTONES,
	MAX_PEOPLE,
	type BuilderDraft,
	type DraftPerson,
	type FieldErrors,
	type Notice
} from './draft.ts';

// ---------------------------------------------------------------------------
// What a draft becomes once every field has passed
// ---------------------------------------------------------------------------

export interface CheckedPerson {
	key: string;
	role: PartyRole;
	name: string;
	title: string;
	email: string;
	relationship: PartyRelationship;
	relationshipReason: string | null;
}

export interface CheckedMilestone {
	key: string;
	title: string;
	description: string;
	kind: MilestoneKind;
	dueDate: string;
	ownerKey: string;
	confirmerKey: string;
}

export interface CheckedDraft {
	project: {
		title: string;
		summary: string;
		beneficiary: string;
		creatorName: string;
		creatorEmail: string;
	};
	fundingGoal: Amount | null;
	milestones: CheckedMilestone[];
	people: CheckedPerson[];
	cadence: Cadence;
}

export interface Checked {
	errors: FieldErrors;
	notices: Notice[];
	/** The draft with every value checked and tidied. Null while anything is wrong. */
	value: CheckedDraft | null;
}

// ---------------------------------------------------------------------------
// One field against one contract schema
// ---------------------------------------------------------------------------

interface Words {
	/** Said when the field is required and empty. */
	empty: string;
	/** Said when the value is not of the right kind: not an email address, not a date. */
	invalid?: string;
}

type Field<T> = { ok: true; value: T } | { ok: false; message: string };

function field<T>(schema: z.ZodType<T>, value: unknown, words: Words): Field<T> {
	const result = schema.safeParse(value);
	if (result.success) return { ok: true, value: result.data };
	const issue = result.error.issues[0];
	if (issue?.code === 'too_big') {
		return { ok: false, message: `Keep this to ${String(issue.maximum)} characters or fewer.` };
	}
	if (issue?.code === 'too_small') return { ok: false, message: words.empty };
	return { ok: false, message: words.invalid ?? words.empty };
}

const tidy = (value: string): string => value.trim().replace(/[ \t]+/g, ' ');

// ---------------------------------------------------------------------------
// The goal
// ---------------------------------------------------------------------------

const AMOUNT_DECIMALS = Math.round(Math.log10(AMOUNT_UNITS_PER_USD_TDN));

/**
 * Reads a goal as typed ("12,000" or "12000.50") into the contracts' amount: a whole number
 * of the smallest unit. Empty means no goal, which the contract allows; nothing is assumed.
 */
export function readGoal(typed: string): Field<Amount | null> {
	const plain = typed.replace(/[,\s]/g, '');
	if (plain === '') return { ok: true, value: null };
	const match = /^(\d{1,12})(?:\.(\d*))?$/.exec(plain);
	if (!match) {
		return { ok: false, message: 'Enter the goal as a number, such as 12,000 or 12000.50.' };
	}
	const fraction = match[2] ?? '';
	if (fraction.length > AMOUNT_DECIMALS) {
		return {
			ok: false,
			message: `Use at most ${String(AMOUNT_DECIMALS)} digits after the decimal point.`
		};
	}
	const units =
		Number(match[1]) * AMOUNT_UNITS_PER_USD_TDN + Number(fraction.padEnd(AMOUNT_DECIMALS, '0'));
	return field(campaignSchema.shape.fundingGoal, units, {
		empty: 'A goal has to be more than nothing. Leave this empty if there is no goal yet.',
		invalid: 'That goal is too large to record.'
	});
}

// ---------------------------------------------------------------------------
// The whole draft
// ---------------------------------------------------------------------------

const campaign = campaignSchema.shape;
const milestone = milestoneSchema.shape;
const party = partySchema.shape;
// A reason is optional in the contract: null when none is given.
const reasonSchema = party.relationshipReason.unwrap();

const sameAddress = (a: string, b: string): boolean => a !== '' && a === b;

export function checkDraft(draft: BuilderDraft): Checked {
	const errors: FieldErrors = {};
	const put = <T>(name: string, result: Field<T>): T | undefined => {
		if (result.ok) return result.value;
		errors[name] = result.message;
		return undefined;
	};

	// --- Project ---
	const title = put(
		'project.title',
		field(campaign.title, tidy(draft.project.title), { empty: 'Give the project a name.' })
	);
	const summary = put(
		'project.summary',
		field(campaign.summary, draft.project.summary.trim(), { empty: 'Describe the project.' })
	);
	const beneficiary = put(
		'project.beneficiary',
		field(campaign.beneficiary, tidy(draft.project.beneficiary), {
			empty: 'Say who the project is for.'
		})
	);
	const creatorName = put(
		'project.creatorName',
		field(campaign.creatorName, tidy(draft.project.creatorName), {
			empty: 'Enter the name of the person or group organising the project.'
		})
	);
	const creatorEmail = put(
		'project.creatorEmail',
		field(campaign.creatorEmail, draft.project.creatorEmail, {
			empty: 'Enter an email address, such as name@example.org.'
		})
	);

	// --- Funding ---
	const fundingGoal = put('funding.goal', readGoal(draft.funding.goal));

	// --- People ---
	if (draft.people.length > MAX_PEOPLE) {
		errors['people._'] = `A campaign can be created with at most ${String(MAX_PEOPLE)} people.`;
	}
	const people: CheckedPerson[] = [];
	for (const person of draft.people.slice(0, MAX_PEOPLE)) {
		const at = `people.${person.key}`;
		const name = put(
			`${at}.name`,
			field(party.name, tidy(person.name), { empty: 'Enter a name.' })
		);
		const role = put(
			`${at}.title`,
			field(party.title, tidy(person.title), { empty: 'Say what they do on the project.' })
		);
		const email = put(
			`${at}.email`,
			field(party.email, person.email, {
				empty: 'Enter an email address, such as name@example.org.'
			})
		);

		// Someone who does the work takes part in the project: that is what the role means.
		let relationship: PartyRelationship | undefined = 'participant';
		let reason: string | null | undefined = null;
		if (person.role === 'confirmer') {
			relationship = put(
				`${at}.relationship`,
				field(partyRelationshipSchema, person.relationship, {
					empty: 'Choose how they are related to the project.'
				})
			);
			const typed = tidy(person.relationshipReason);
			if (typed !== '') {
				reason = put(
					`${at}.relationshipReason`,
					field(reasonSchema, typed, { empty: 'Say why, in a sentence.' })
				);
			} else if (relationship === 'independent') {
				// Donors read "independent" as a promise, so it is never recorded without a reason.
				errors[`${at}.relationshipReason`] =
					'Say in a sentence why they have no stake in the project. Donors see this.';
				reason = undefined;
			}
		}
		if (
			name !== undefined &&
			role !== undefined &&
			email !== undefined &&
			relationship !== undefined &&
			reason !== undefined
		) {
			people.push({
				key: person.key,
				role: person.role,
				name,
				title: role,
				email,
				relationship,
				relationshipReason: reason
			});
		}
	}
	const checkedByKey = new Map(people.map((person) => [person.key, person]));
	const draftByKey = new Map(draft.people.map((person) => [person.key, person]));

	// An independent confirmer cannot also be someone who takes part: same address, same person.
	for (const person of people) {
		if (person.role !== 'confirmer' || person.relationship !== 'independent') continue;
		const worker = people.find(
			(other) => other.role === 'third_party' && sameAddress(other.email, person.email)
		);
		if (creatorEmail !== undefined && sameAddress(creatorEmail, person.email)) {
			errors[`people.${person.key}.relationship`] =
				'This is the organiser’s own email address. The organiser takes part in the project, so choose “Takes part in it, or is paid by it”.';
		} else if (worker) {
			errors[`people.${person.key}.relationship`] =
				`This is the same email address as ${worker.name}, who does the work. Someone paid by the project is not independent.`;
		}
	}
	if (!draft.people.some((person) => person.role === 'third_party')) {
		errors['people.third_party'] = 'Add at least one contractor or supplier who does the work.';
	}
	if (!draft.people.some((person) => person.role === 'confirmer')) {
		errors['people.confirmer'] = 'Add at least one person to confirm milestones.';
	}

	// --- Milestones, and who does and confirms each ---
	if (draft.milestones.length === 0) {
		errors['milestones._'] = 'Add at least one milestone.';
	} else if (draft.milestones.length > MAX_MILESTONES) {
		errors['milestones._'] =
			`A campaign can be created with at most ${String(MAX_MILESTONES)} milestones.`;
	}
	const milestones: CheckedMilestone[] = [];
	for (const item of draft.milestones.slice(0, MAX_MILESTONES)) {
		const at = `milestones.${item.key}`;
		const name = put(
			`${at}.title`,
			field(milestone.title, tidy(item.title), { empty: 'Give the milestone a name.' })
		);
		const description = put(
			`${at}.description`,
			field(milestone.description, item.description.trim(), {
				empty: 'Describe what will be delivered.'
			})
		);
		const kind = put(
			`${at}.kind`,
			field(milestoneKindSchema, item.kind, { empty: 'Choose the kind of milestone.' })
		);
		const dueDate = put(
			`${at}.dueDate`,
			field(milestone.dueDate, item.dueDate, { empty: 'Choose the date this is due.' })
		);

		const owner = draftByKey.get(item.ownerKey);
		const confirmer = draftByKey.get(item.confirmerKey);
		let assigned = true;
		if (!owner || owner.role !== 'third_party') {
			errors[`assign.${item.key}.owner`] = 'Choose who does the work on this milestone.';
			assigned = false;
		}
		if (owner && confirmer && doesTheWork(owner, confirmer)) {
			errors[`assign.${item.key}.confirmer`] =
				`${owner.name.trim() || 'This person'} does the work on this milestone, so someone else has to confirm it.`;
			assigned = false;
		} else if (!confirmer || confirmer.role !== 'confirmer') {
			errors[`assign.${item.key}.confirmer`] = 'Choose who confirms this milestone.';
			assigned = false;
		}
		if (
			assigned &&
			name !== undefined &&
			description !== undefined &&
			kind !== undefined &&
			dueDate !== undefined
		) {
			milestones.push({
				key: item.key,
				title: name,
				description,
				kind,
				dueDate,
				ownerKey: item.ownerKey,
				confirmerKey: item.confirmerKey
			});
		}
	}

	// --- Schedule ---
	const cadence = put(
		'schedule.cadence',
		field(cadenceSchema, draft.schedule.cadence, {
			empty: 'Choose how often work is reported.'
		})
	);

	const clean = Object.keys(errors).length === 0;
	const value: CheckedDraft | null =
		clean &&
		title !== undefined &&
		summary !== undefined &&
		beneficiary !== undefined &&
		creatorName !== undefined &&
		creatorEmail !== undefined &&
		fundingGoal !== undefined &&
		cadence !== undefined &&
		milestones.every(
			(item) => checkedByKey.has(item.ownerKey) && checkedByKey.has(item.confirmerKey)
		)
			? {
					project: { title, summary, beneficiary, creatorName, creatorEmail },
					fundingGoal,
					milestones,
					people,
					cadence
				}
			: null;

	return { errors, notices: noticesFor(draft), value };
}

/** True when `confirmer` is the person doing the work: the same entry, or the same address. */
function doesTheWork(owner: DraftPerson, confirmer: DraftPerson): boolean {
	if (owner.key === confirmer.key) return true;
	return sameAddress(owner.email.trim().toLowerCase(), confirmer.email.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Notices: allowed, but said before donors see it
// ---------------------------------------------------------------------------

const plainWords = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/**
 * What the organiser should know and may leave as it is.
 *
 * - A confirmer marked independent whose name is in "who it is for", or is the organiser's
 *   name. This compares the words typed and nothing else, so it only catches the plain case;
 *   the rule itself ("someone who benefits is never independent") is shown on every card.
 * - A milestone whose confirmer is not independent: allowed, and donors will see which.
 */
export function noticesFor(draft: BuilderDraft): Notice[] {
	const notices: Notice[] = [];
	const beneficiary = ` ${plainWords(draft.project.beneficiary)} `;
	const organiser = plainWords(draft.project.creatorName);

	for (const person of draft.people) {
		if (person.role !== 'confirmer' || person.relationship !== 'independent') continue;
		const name = plainWords(person.name);
		if (name.length < 3) continue;
		const benefits = beneficiary.includes(` ${name} `);
		if (benefits || name === organiser) {
			notices.push({
				key: person.key,
				kind: 'independent_may_benefit',
				title: `${person.name.trim()} is marked independent`,
				body: benefits
					? 'Their name is in “who it is for”. Someone who benefits from the project is a stakeholder, not independent. Change this unless they really have no stake.'
					: 'This is the organiser’s name. The organiser takes part in the project, so is not independent. Change this unless it is a different person.'
			});
		}
	}

	const people = new Map(draft.people.map((person) => [person.key, person]));
	draft.milestones.forEach((item, index) => {
		const confirmer = people.get(item.confirmerKey);
		if (!confirmer || confirmer.role !== 'confirmer') return;
		if (confirmer.relationship === '' || confirmer.relationship === 'independent') return;
		const who = confirmer.name.trim() || 'the confirmer';
		notices.push({
			key: item.key,
			kind: 'no_independent_confirmer',
			title: `Milestone ${String(index + 1)} has no independent confirmer`,
			body: `That’s allowed. Donors will see ${who}’s confirmation as a ${confirmer.relationship} confirmation.`
		});
	});
	return notices;
}
