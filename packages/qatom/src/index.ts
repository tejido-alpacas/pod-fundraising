/**
 * @tejido/qatom: the one place that talks to Qatom. Server-only.
 *
 * The app deals with Qatom as two different actors, and they live in two separate modules:
 *
 *   @tejido/qatom/person    a person signed in with Qatom (OIDC_* settings)
 *   @tejido/qatom/account   Tejido's merchant account (QATOM_ACCOUNT_* settings)
 *
 * This entry point exports only what both share: the errors and a helper for comparing
 * wallet addresses. It deliberately exports no function that calls Qatom.
 */
export * from './errors.ts';

/**
 * The hostname of a twin, whether it is written as a bare hostname (the sign-in claims) or as
 * a twin URL (what a transfer takes). Null if the value is neither.
 */
export function twinHostname(address: string): string | null {
	const trimmed = address.trim().toLowerCase();
	const url = URL.parse(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
	return url && url.hostname !== '' && url.pathname === '/' ? url.hostname : null;
}

/**
 * Whether two addresses name the same twin. Use it to compare a ledger's paying address with
 * a party's agent wallet: the document does not say which of the two forms the ledger uses.
 */
export function sameTwin(a: string, b: string): boolean {
	const hostname = twinHostname(a);
	return hostname !== null && hostname === twinHostname(b);
}
