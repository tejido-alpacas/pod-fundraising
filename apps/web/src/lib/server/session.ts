/**
 * Sealed cookies: the session, and the short-lived state of a sign-in in progress.
 *
 * A sealed value is encrypted and authenticated with a key derived from SESSION_SECRET, so the
 * browser can neither read it nor change it. Access tokens are not kept here.
 */
import type { PendingSignIn } from '@tejido/qatom/person';
import type { Cookies } from '@sveltejs/kit';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface Session {
	/** Qatom's identifier for the person. */
	sub: string;
	email: string;
	/** The party this person signed in as, when they came from an invite. */
	partyId: string | null;
}

/** What a sign-in must remember between leaving for Qatom and coming back. */
export interface SignInState {
	pending: PendingSignIn;
	partyId: string | null;
	returnTo: string;
}

const SESSION_COOKIE = 'tejido_session';
const SIGN_IN_COOKIE = 'tejido_sign_in';
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

function options(cookies: Cookies, maxAge: number) {
	void cookies;
	// `lax` so the cookie is sent when Qatom redirects the browser back to us.
	return { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge };
}

export function readSession(cookies: Cookies, secret: string): Session | null {
	return unseal<Session>(cookies.get(SESSION_COOKIE), secret, 'session');
}

export function writeSession(cookies: Cookies, secret: string, session: Session): void {
	cookies.set(
		SESSION_COOKIE,
		seal(session, secret, 'session', SESSION_SECONDS),
		options(cookies, SESSION_SECONDS)
	);
}

export function clearSession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function writeSignInState(cookies: Cookies, secret: string, state: SignInState): void {
	cookies.set(
		SIGN_IN_COOKIE,
		seal(state, secret, 'sign-in', SIGN_IN_SECONDS),
		options(cookies, SIGN_IN_SECONDS)
	);
}

/** Reads the sign-in state and deletes it: each sign-in can be finished once. */
export function takeSignInState(cookies: Cookies, secret: string): SignInState | null {
	const state = unseal<SignInState>(cookies.get(SIGN_IN_COOKIE), secret, 'sign-in');
	cookies.delete(SIGN_IN_COOKIE, { path: '/' });
	return state;
}
