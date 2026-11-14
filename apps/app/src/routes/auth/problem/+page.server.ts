import { isSignInProblem, linkablePartyId, SIGN_IN_PROBLEMS } from '#lib/server/sign-in-problem.ts';
import type { PageServerLoad } from './$types';

// Where a sign-in that did not finish ends up. The address carries only the name of the
// problem and, when there was one, the invite to go back to.
export const load: PageServerLoad = ({ url }) => {
	const reason = url.searchParams.get('reason');
	// An address someone typed or altered still gets a sensible page.
	const problem = SIGN_IN_PROBLEMS[isSignInProblem(reason) ? reason : 'not_trusted'];

	return {
		// What the layout draws above the page: the design's field header.
		header: { title: 'Sign-in', subtitle: 'Tejido field app' },
		title: problem.title,
		message: problem.message,
		retry: problem.retry,
		partyId: linkablePartyId(url.searchParams.get('party'))
	};
};
