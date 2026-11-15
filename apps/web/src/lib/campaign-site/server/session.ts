/**
 * Sealed cookies for donors on the Campaign Site: the session, and the short-lived state of a
 * sign-in in progress. Copied from the App's session module (apps/app/src/lib/server/session.ts);
 * the two apps never import from each other.
 *
 * A sealed value is encrypted and authenticated with a key derived from SESSION_SECRET, so the
 * browser can neither read it nor change it. No token is kept here, or anywhere: a donor's
 * session holds only who they are.
 *
 * The cookie names and sealing purposes differ from the App's on purpose. Locally both apps run
 * on localhost, where cookies ignore the port, and both use the same SESSION_SECRET. With the
 * same names, an App session would count as a donor session here.
 */
import type { PendingSignIn } from '@tejido/qatom/person';
import type { Cookies } from '@sveltejs/kit';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface DonorSession {
	/** Qatom's identifier for the person. */
	sub: string;
	email: string;
}

/** What a sign-in must remember between leaving for Qatom and coming back. */
export interface DonorSignInState {
	pending: PendingSignIn;
	returnTo: string;
}

const SESSION_COOKIE = 'tejido_donor_session';
const SIGN_IN_COOKIE = 'tejido_donor_sign_in';
const SESSION_PURPOSE = 'donor-session';
const SIGN_IN_PURPOSE = 'donor-sign-in';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const SIGN_IN_SECONDS = 60 * 10;

function key(secret: string, purpose: string): Buffer {
	return Buffer.from(hkdfSync('sha256', secret, 'tejido', purpose, 32));
}

/** Encrypts `value` for one purpose, with an expiry inside the sealed data. */
export function seal(value: unknown, secret: string, purpose: string, seconds: number): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(secret, purpose), iv);
	const plaintext = JSON.stringify({ value, expires: Date.now() + seconds * 1000 });
	const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

/** Returns the sealed value, or null if it is missing, altered, expired or for another purpose. */
export function unseal<T>(sealed: string | undefined, secret: string, purpose: string): T | null {
	if (!sealed) return null;
	try {
		const bytes = Buffer.from(sealed, 'base64url');
		const decipher = createDecipheriv('aes-256-gcm', key(secret, purpose), bytes.subarray(0, 12));
		decipher.setAuthTag(bytes.subarray(12, 28));
		const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
		const { value, expires } = JSON.parse(plaintext.toString('utf8')) as {
			value: T;
			expires: number;
		};
		return expires > Date.now() ? value : null;
	} catch {
		return null;
	}
}

// `lax` so the cookie is sent when Qatom redirects the browser back to us.
function options(maxAge: number) {
	return { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge };
}

export function readDonorSession(cookies: Cookies, secret: string): DonorSession | null {
	return unseal<DonorSession>(cookies.get(SESSION_COOKIE), secret, SESSION_PURPOSE);
}

export function writeDonorSession(cookies: Cookies, secret: string, session: DonorSession): void {
	cookies.set(
		SESSION_COOKIE,
		seal(session, secret, SESSION_PURPOSE, SESSION_SECONDS),
		options(SESSION_SECONDS)
	);
}

export function clearDonorSession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function writeDonorSignInState(
	cookies: Cookies,
	secret: string,
	state: DonorSignInState
): void {
	cookies.set(
		SIGN_IN_COOKIE,
		seal(state, secret, SIGN_IN_PURPOSE, SIGN_IN_SECONDS),
		options(SIGN_IN_SECONDS)
	);
}

/** Reads the sign-in state and deletes it: each sign-in can be finished once. */
export function takeDonorSignInState(cookies: Cookies, secret: string): DonorSignInState | null {
	const state = unseal<DonorSignInState>(cookies.get(SIGN_IN_COOKIE), secret, SIGN_IN_PURPOSE);
	cookies.delete(SIGN_IN_COOKIE, { path: '/' });
	return state;
}

/** A path on this site, never another site. */
export function safeReturnTo(value: string | null): string {
	return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
		? value
		: '/';
}
