import type { PartyRole } from '@tejido/contracts';

/** How each role is named and explained to the person who holds it. */
export const ROLES: Record<PartyRole, { name: string; does: string }> = {
	third_party: {
		name: 'Third party',
		does: 'You do the work or supply the goods. You log your work on a schedule and say when a milestone is done.'
	},
	confirmer: {
		name: 'Confirmer',
		does: 'You are independent of the work. You sign a milestone off once you have seen it is done.'
	}
};
