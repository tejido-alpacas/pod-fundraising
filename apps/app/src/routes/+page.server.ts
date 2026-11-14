import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	// Shown so you can tell at a glance whether the sign-in worked. Never the wallets or tokens.
	signedInAs: locals.session?.email ?? null
});
