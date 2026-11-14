import { QatomSignInError, type SignInFailure } from '@tejido/qatom';
import { describe, expect, it } from 'vitest';
import {
	isSignInProblem,
	problemForSignInError,
	problemPath,
	SIGN_IN_PROBLEMS
} from './sign-in-problem.ts';

const FAILURES: SignInFailure[] = [
	'authorization_refused',
	'state_mismatch',
	'missing_code',
	'issuer_mismatch',
	'invalid_id_token',
	'email_unverified',
	'missing_claims'
];

describe('sign-in problems', () => {
	it.each(FAILURES)('has a page for the Qatom failure %s', (failure) => {
		const problem = problemForSignInError(new QatomSignInError(failure, 'internal wording'));
		expect(isSignInProblem(problem)).toBe(true);
	});

	it('explains every problem in words, without our internal names', () => {
		for (const { title, message } of Object.values(SIGN_IN_PROBLEMS)) {
			expect(title.length).toBeGreaterThan(10);
			expect(message.length).toBeGreaterThan(40);
			expect(title + message).not.toMatch(/claim|scope|token|OIDC|nonce|_/);
		}
	});

	it('only recognises its own names', () => {
		expect(isSignInProblem('wrong_email')).toBe(true);
		expect(isSignInProblem('toString')).toBe(false);
		expect(isSignInProblem('<script>')).toBe(false);
		expect(isSignInProblem(null)).toBe(false);
	});

	it('links back to the invite only when the party id is plain', () => {
		expect(problemPath('refused', 'pty-contractor')).toBe(
			'/auth/problem?reason=refused&party=pty-contractor'
		);
		expect(problemPath('refused', null)).toBe('/auth/problem?reason=refused');
		expect(problemPath('refused', '../../evil?x=1')).toBe('/auth/problem?reason=refused');
	});
});
