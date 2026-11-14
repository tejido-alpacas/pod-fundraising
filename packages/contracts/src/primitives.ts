import { z } from 'zod';

/** An identifier we mint ourselves. Opaque: compare it, never parse it. */
export const idSchema = z.string().min(1).max(100);

/** A moment in time as an ISO 8601 UTC string, e.g. `2026-11-13T17:02:19.000Z`. */
export const timestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof timestampSchema>;

/** A calendar date with no time, e.g. `2026-11-27`. */
export const dateSchema = z.iso.date();

/** An email address, trimmed and lower-cased so two spellings of one address compare equal. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** A SHA-256 digest as 64 hexadecimal characters, lower-cased. */
export const sha256Schema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^[0-9a-f]{64}$/, { error: 'must be a SHA-256 digest: 64 hexadecimal characters' });

// ---------------------------------------------------------------------------
// Wallet hostnames
// ---------------------------------------------------------------------------

const hostnameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(
		/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
		{ error: 'must be a bare hostname, with no scheme, path or port' }
	);

/**
 * A person's AGENT wallet: the `agent_twin_hostname` claim from their Qatom sign-in.
 *
 * Deposits are paid from this wallet, so it is the address we expect to see as the payer
 * in the ledger. It is never a refund destination.
 */
export const agentWalletHostnameSchema = hostnameSchema.brand<'AgentWalletHostname'>();
export type AgentWalletHostname = z.infer<typeof agentWalletHostnameSchema>;

/**
 * A person's PRIMARY wallet: the `twin_hostname` claim from their Qatom sign-in.
 *
 * Refunds are sent here, and only here.
 */
export const primaryWalletHostnameSchema = hostnameSchema.brand<'PrimaryWalletHostname'>();
export type PrimaryWalletHostname = z.infer<typeof primaryWalletHostnameSchema>;

// The two hostnames are branded as different types on purpose. A function that sends money
// takes a PrimaryWalletHostname, so passing it a party's agent wallet does not compile.

// ---------------------------------------------------------------------------
// Reporter codes
// ---------------------------------------------------------------------------

// Lower-case letters and digits without the look-alikes 0, 1, i, l and o.
const REPORTER_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const REPORTER_CODE_LENGTH = 20;

/**
 * The private code a party includes in every check-in.
 *
 * Qatom calls our check-in endpoint with the item's declared inputs only, never the payer's
 * identity, so this code is how an entry names its filer. One code maps to one party on one
 * campaign. Format: `rc_` followed by 20 characters, e.g. `rc_k7m2q9x4w8n5b3t6v2zj`.
 */
export const reporterCodeSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^rc_[2-9a-hjkmnp-z]{20}$/, {
		error: 'must be a reporter code: rc_ followed by 20 letters and digits'
	});
export type ReporterCode = z.infer<typeof reporterCodeSchema>;

/** Mints a new reporter code with about 99 bits of randomness. */
export function generateReporterCode(): ReporterCode {
	const alphabet = REPORTER_CODE_ALPHABET;
	// Bytes at or above this limit are thrown away so every character is equally likely.
	const limit = 256 - (256 % alphabet.length);
	let code = '';
	while (code.length < REPORTER_CODE_LENGTH) {
		for (const byte of crypto.getRandomValues(new Uint8Array(REPORTER_CODE_LENGTH))) {
			if (byte < limit && code.length < REPORTER_CODE_LENGTH) {
				code += alphabet[byte % alphabet.length];
			}
		}
	}
	return `rc_${code}`;
}
