import type { PartyRole } from '@tejido/contracts';

/**
 * How each role is named and explained to the person who holds it. A party's own title
 * ("Contractor", "Book supplier", "Head teacher") is shown first where there is one; `name` is
 * what the role is called when there is none.
 */
export const ROLES: Record<PartyRole, { name: string; does: string; deposit: string }> = {
	third_party: {
		name: 'Contractor or supplier',
		does: 'You do the work or supply the goods. You log your work on a schedule and report each milestone when it is done.',
		deposit: 'one pays a small deposit each time you file a report, the other gets it back'
	},
	confirmer: {
		name: 'Confirmer',
		does: 'You check the work that is reported as done, then confirm the milestone once you have seen it yourself.',
		deposit: 'one pays a small deposit each time you confirm, the other gets it back'
	}
};

/** The role as this person is called on their project. */
export function roleName(party: { role: PartyRole; title: string }): string {
	return party.title.trim() || ROLES[party.role].name;
}

export const CADENCE = { weekly: 'every week', fortnightly: 'every two weeks' } as const;
