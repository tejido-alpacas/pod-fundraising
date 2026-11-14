/**
 * Every failure this package can throw. Catch `QatomError` to catch them all.
 *
 * None of these errors carries a token, a secret, a request header or a raw response body,
 * so they are safe to log.
 */
export class QatomError extends Error {
	/** Which call failed, e.g. `account.transfer` or `person.token`. */
	readonly operation: string;

	constructor(operation: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'QatomError';
		this.operation = operation;
	}
}

/**
 * Qatom answered, and the answer was an error.
 *
 * Qatom's API document defines one error body for every non-2xx response:
 * `{ "error": "Authentication required", "status": 401 }`. There is no separate machine code;
 * `error` is the nearest thing, and on some responses it is one (`account_not_granted`).
 * The sign-in endpoints follow OAuth instead, where `error` is a code such as `invalid_grant`.
 * Either way it is in `code`.
 */
export class QatomHttpError extends QatomError {
	/** The HTTP status Qatom answered with. */
	readonly status: number;
	/** Qatom's `error` field. Null when the body had none or was not JSON. */
	readonly code: string | null;
	/** Qatom's `message` or `error_description`, when it sent one. */
	readonly detail: string | null;

	constructor(
		operation: string,
		status: number,
		code: string | null = null,
		detail: string | null = null
	) {
		super(
			operation,
			`Qatom ${operation} failed with ${status}${code ? `: ${code}` : ''}${detail ? ` (${detail})` : ''}`
		);
		this.name = 'QatomHttpError';
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}

/**
 * No answer arrived within the time limit.
 *
 * For a transfer this means the outcome is UNKNOWN: the money may have moved. Do not retry it
 * blindly.
 */
export class QatomTimeoutError extends QatomError {
	readonly timeoutMs: number;

	constructor(operation: string, timeoutMs: number) {
		super(operation, `Qatom ${operation} did not answer within ${timeoutMs} ms`);
		this.name = 'QatomTimeoutError';
		this.timeoutMs = timeoutMs;
	}
}

/**
 * The request never got an answer: DNS, TLS, a refused or dropped connection.
 * As with a timeout, a transfer that fails this way has an unknown outcome.
 */
export class QatomNetworkError extends QatomError {
	constructor(operation: string, cause: unknown) {
		super(operation, `Qatom ${operation} could not be reached`, { cause });
		this.name = 'QatomNetworkError';
	}
}

/** Qatom answered with success, but not in the shape its API document describes. */
export class QatomResponseError extends QatomError {
	constructor(operation: string, problem: string) {
		super(operation, `Qatom ${operation} answered in an unexpected shape: ${problem}`);
		this.name = 'QatomResponseError';
	}
}

/**
 * Qatom answered, and its catalog has no item for this commodity id that the merchant account
 * may manage: the id is wrong, belongs to another Qatom environment, or is another account's.
 * There is no hash to read a ledger with, and none is guessed.
 */
export class QatomUnknownCommodityError extends QatomError {
	readonly commodityId: number;

	constructor(operation: string, commodityId: number) {
		super(
			operation,
			`Qatom ${operation} found no catalog item for commodity id ${commodityId} that the merchant account may manage`
		);
		this.name = 'QatomUnknownCommodityError';
		this.commodityId = commodityId;
	}
}

export type SignInFailure =
	/** The person, or Qatom, declined at the authorization step. `code` holds Qatom's reason. */
	| 'authorization_refused'
	/** The callback did not carry the `state` this sign-in started with. */
	| 'state_mismatch'
	/** The callback carried no authorization code. */
	| 'missing_code'
	/** The callback or the ID token named an issuer other than the one discovered. */
	| 'issuer_mismatch'
	/** The ID token failed validation: signature, audience, expiry or nonce. */
	| 'invalid_id_token'
	/** Qatom says the email address is not verified, so it cannot tie a sign-in to an invite. */
	| 'email_unverified'
	/** The sign-in did not return an email and both wallet hostnames. */
	| 'missing_claims';

/** A sign-in that reached Qatom but cannot be trusted or completed. */
export class QatomSignInError extends QatomError {
	readonly failure: SignInFailure;
	/** Qatom's OAuth error code, for `authorization_refused`. */
	readonly code: string | null;

	constructor(failure: SignInFailure, message: string, code: string | null = null) {
		super('person.sign-in', message);
		this.name = 'QatomSignInError';
		this.failure = failure;
		this.code = code;
	}
}
