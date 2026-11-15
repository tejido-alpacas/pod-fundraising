/**
 * Where a person is sent after signing in. Track B owns this file.
 *
 * Only ever a path on the App itself. The value arrives in an address anyone can write, so
 * anything that could take the browser to another site is replaced by the home page.
 */

/** Spaces, control characters and backslashes: browsers drop or rewrite these in an address. */
function hasUnsafeCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
	}
	return false;
}

/**
 * `value` if it is a path on this site, otherwise `/`. `origin` is the App's own origin.
 *
 * A value must start with one slash, and must still point at this origin once a browser has
 * read it. So `//other.example`, `/\\other.example`, `https://other.example` and a path with
 * a tab or a line break hidden in it all become `/`.
 */
export function safeReturnTo(value: string | null, origin: string): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || hasUnsafeCharacter(value)) {
		return '/';
	}
	let resolved: URL;
	try {
		resolved = new URL(value, origin);
	} catch {
		return '/';
	}
	if (resolved.origin !== new URL(origin).origin) return '/';
	// `/..//other.example` resolves to a path of `//other.example`, which a browser would then
	// read as another site.
	if (resolved.pathname.startsWith('//')) return '/';
	return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/** The address that starts a sign-in and brings the person back to `returnTo` afterwards. */
export function signInPath(returnTo: string, partyId: string | null = null): string {
	const query = new URLSearchParams();
	if (partyId !== null) query.set('party', partyId);
	query.set('return_to', returnTo);
	return `/auth/sign-in?${query.toString()}`;
}
