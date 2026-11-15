/**
 * The builder's fixed words: the contracts' values as an organiser reads them. One list per
 * enum, so a value added to a contract fails typecheck here until it has words.
 */
import type { Cadence, MilestoneKind, PartyRelationship, PartyRole } from '@tejido/contracts';
import type { Step } from './draft.ts';

export const STEP_NAME: Record<Step, string> = {
	project: 'Project',
	funding: 'Funding',
	milestones: 'Milestones',
	people: 'People',
	schedule: 'Schedule',
	review: 'Review'
};

export const KIND_LABEL: Record<MilestoneKind, string> = {
	construction: 'Construction',
	goods_delivery: 'Goods delivery',
	funds_handover: 'Funds handover',
	service: 'Service'
};

export const KIND_HELP: Record<MilestoneKind, string> = {
	construction: 'Something is built or repaired.',
	goods_delivery: 'Goods are delivered and signed for.',
	funds_handover: 'Money is handed to the people it is for.',
	service: 'A service is carried out, such as training or a clinic day.'
};

export const CADENCE_LABEL: Record<Cadence, string> = {
	weekly: 'Every week',
	fortnightly: 'Every two weeks'
};

export const CADENCE_HELP: Record<Cadence, string> = {
	weekly: 'Each contractor and supplier files a short work report once a week.',
	fortnightly: 'Each contractor and supplier files a short work report once every two weeks.'
};

export const ROLE_LABEL: Record<PartyRole, string> = {
	third_party: 'Does the work',
	confirmer: 'Confirms milestones'
};

/** The three choice cards, in the order the design shows them. */
export const RELATIONSHIP_CHOICES: {
	value: PartyRelationship;
	label: string;
	example: string;
}[] = [
	{
		value: 'participant',
		label: 'Takes part in it, or is paid by it',
		example: 'For example the organiser or a contractor'
	},
	{
		value: 'stakeholder',
		label: 'Benefits from it, or speaks for those who do',
		example: 'For example the head teacher'
	},
	{
		value: 'independent',
		label: 'Independent: no stake in the project',
		example: 'For example a parish building inspector'
	}
];

export const RELATIONSHIP_LABEL: Record<PartyRelationship, string> = {
	participant: 'Participant',
	stakeholder: 'Stakeholder',
	independent: 'Independent'
};

/** The unit every amount is in. Written out, because it is not dollars. */
export const UNIT = 'USD-TDN';

/** A due date for people: "27 Nov 2026". Anything that is not a date is shown as typed. */
export function formatDue(date: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
	const parsed = new Date(`${date}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	return parsed.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
