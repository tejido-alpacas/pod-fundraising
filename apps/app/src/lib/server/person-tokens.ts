/**
 * Keeping a signed-in person's Qatom tokens for the agent chat. Track B owns this file.
 *
 * The chat's server code needs the person's access token to reach the Qatom MCP server as
 * them. The tokens are kept in our database, one row per party, and only ever sealed:
 * encrypted and authenticated with a key derived from SESSION_SECRET, the same way the session
 * cookie is, under a purpose of its own so that neither can pass for the other.
 *
 * `packages/db` stores the sealed string and never sees a key or a token. The tokens never go
 * to the browser, into a cookie or into a log.
 *
 * This is Qatom identity 1, a person. These tokens are never used for a ledger read or a
 * transfer.
 */
import {
	deleteSealedSignInTokens,
	readSealedSignInTokens,
	saveSealedSignInTokens,
	type Database
} from '@tejido/db';
import type { PersonAccessToken, SignedInPerson } from '@tejido/qatom/person';
import { seal, unseal } from './session.ts';

export type PersonTokens = SignedInPerson['tokens'];

const PURPOSE = 'person-tokens';
/**
 * How long a sealed row can be opened: as long as Qatom's refresh token lives (30 days, in
 * Qatom's `src/v4/oidc/ttl.ts`). The access token inside expires sooner, on its own clock.
 */
const SEALED_SECONDS = 60 * 60 * 24 * 30;

export function sealPersonTokens(tokens: PersonTokens, secret: string): string {
	return seal(
		{
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			expiresAtMs: tokens.expiresAtMs
		},
		secret,
		PURPOSE,
		SEALED_SECONDS
	);
}

/** Returns the tokens, or null if the sealed value is missing, altered, expired or not tokens. */
export function unsealPersonTokens(
	sealed: string | undefined,
	secret: string
): PersonTokens | null {
	const value = unseal<Record<string, unknown>>(sealed, secret, PURPOSE);
	if (typeof value !== 'object' || value === null) return null;
	const { accessToken, refreshToken, expiresAtMs } = value;
	if (typeof accessToken !== 'string' || accessToken === '') return null;
	if (refreshToken !== null && typeof refreshToken !== 'string') return null;
	if (expiresAtMs !== null && typeof expiresAtMs !== 'number') return null;
	return { accessToken: accessToken as PersonAccessToken, refreshToken, expiresAtMs };
}

/** Called at sign-in. Replaces whatever was kept for this party before. */
export async function keepPersonTokens(
	db: Database,
	secret: string,
	partyId: string,
	tokens: PersonTokens
): Promise<void> {
	await saveSealedSignInTokens(db, {
		partyId,
		sealedTokens: sealPersonTokens(tokens, secret),
		updatedAt: new Date().toISOString()
	});
}

/** Called at sign-out. */
export async function forgetPersonTokens(db: Database, partyId: string): Promise<void> {
	await deleteSealedSignInTokens(db, partyId);
}

export type UsableToken =
	| { ok: true; accessToken: PersonAccessToken }
	/**
	 * - `none`: nothing is kept for this party, or it cannot be opened.
	 * - `expired`: the access token has run out, or Qatom never said how long it lasts.
	 */
	| { ok: false; reason: 'none' | 'expired' };

/** Leave a margin, so a token does not run out in the middle of a reply. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * The access token the chat may use for this party right now.
 *
 * There is no refresh yet: `packages/qatom` has no call for it. When the access token has run
 * out the person signs in again from their invite link.
 */
export async function usablePersonToken(
	db: Database,
	secret: string,
	partyId: string
): Promise<UsableToken> {
	const row = await readSealedSignInTokens(db, partyId);
	const tokens = unsealPersonTokens(row?.sealedTokens, secret);
	if (!tokens) return { ok: false, reason: 'none' };
	if (tokens.expiresAtMs === null || tokens.expiresAtMs - EXPIRY_MARGIN_MS <= Date.now()) {
		return { ok: false, reason: 'expired' };
	}
	return { ok: true, accessToken: tokens.accessToken };
}
