/**
 * Every way a sign-in can end without the person being signed in, and what to tell them.
 *
 * The sign-in routes are endpoints, so they cannot render a page themselves. When one fails
 * it sends the browser to /auth/problem with one of these names, and that page shows the text.
 * Only the name travels in the URL: never an error message, a token or an email address.
 */
import type { QatomSignInError, SignInFailure } from '@tejido/qatom';

export const SIGN_IN_PROBLEMS = {
	expired: {
		title: 'This sign-in ran out of time',
		message:
			'A sign-in has to be finished within ten minutes, in the same browser it was started in, and can be used once. Nothing was changed. Please start again.',
		retry: true
	},
	refused: {
		title: 'You were not signed in',
		message:
			'The sign-in was cancelled, or Qatom declined it, before it finished. Nothing was changed. You can try again whenever you are ready.',
		retry: true
	},
	not_trusted: {
		title: 'We could not confirm this sign-in',
		message:
			'The answer we got back did not match the sign-in we started, so for your safety we did not accept it. Nothing was changed. Please start again from your invite link.',
		retry: true
	},
	email_unverified: {
		title: 'Your email address is not confirmed with Qatom yet',
		message:
			'Qatom has not verified the email address on your account, so we cannot match you to your invite. Confirm your email with Qatom, then try again.',
		retry: true
	},
	missing_wallets: {
		title: 'Qatom did not tell us your wallets',
		message:
			'You signed in, but Qatom did not send the wallet details we need to link you to the campaign. This is a set-up problem on our side, not something you did wrong. Nothing was changed. Please tell the Tejido team you saw this message.',
		retry: false
	},
	qatom_unavailable: {
		title: 'Qatom could not be reached',
		message:
			'We could not finish the sign-in because Qatom did not answer as expected. Nothing was changed. Please wait a minute and try again.',
		retry: true
	},
	unknown_invite: {
		title: 'We do not recognise this invite',
		message:
			'The invite link is not one we know. Check that you opened the whole link from your invitation, or ask the campaign creator to send it again.',
		retry: false
	},
	wrong_email: {
		title: 'This invite was sent to a different email address',
		message:
			'You signed in to Qatom with an email address that is not the one this invite was sent to, so we did not link your wallets. Sign in with the address the invitation arrived at, or ask the campaign creator to invite the address you use with Qatom.',
		retry: true
	}
} as const satisfies Record<string, { title: string; message: string; retry: boolean }>;

export type SignInProblem = keyof typeof SIGN_IN_PROBLEMS;

export function isSignInProblem(value: string | null): value is SignInProblem {
	return value !== null && Object.hasOwn(SIGN_IN_PROBLEMS, value);
}

// Every failure the Qatom client distinguishes has an entry: typecheck fails if one is added.
const BY_FAILURE: Record<SignInFailure, SignInProblem> = {
	authorization_refused: 'refused',
	state_mismatch: 'not_trusted',
	missing_code: 'not_trusted',
	issuer_mismatch: 'not_trusted',
	invalid_id_token: 'not_trusted',
	email_unverified: 'email_unverified',
	missing_claims: 'missing_wallets'
};

export function problemForSignInError(cause: QatomSignInError): SignInProblem {
	return BY_FAILURE[cause.failure];
}

/** A party id as it may appear in a link back to an invite. Anything else is left out. */
const LINKABLE_PARTY_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function linkablePartyId(value: string | null): string | null {
	return value !== null && LINKABLE_PARTY_ID.test(value) ? value : null;
}

/** The page that explains `problem`, with a way back to the invite when there was one. */
export function problemPath(problem: SignInProblem, partyId: string | null): string {
	const query = new URLSearchParams({ reason: problem });
	const party = linkablePartyId(partyId);
	if (party) query.set('party', party);
	return `/auth/problem?${query.toString()}`;
}
