/**
 * THE ONE EXCEPTION to "refunds go to the primary wallet only" (CLAUDE.md, "Qatom"; the
 * owner's decision of 15 November 2026). FOR THE END-TO-END TEST PEOPLE ONLY.
 *
 * The automatic paid tests pay their deposits from each test person's AGENT wallet. So that
 * those wallets stay funded with nobody topping them up, a test person's deposits on a
 * confirmed milestone go back to that same agent wallet. Qatom's `POST /v4/transfer` cannot
 * pay out of the twin an item is sold from, so the refund is sent by that twin's OWN API:
 *
 *   1. the item's ledger (GET /v4/commodity/{hash}/transactions) names the item's twin and the
 *      digital quantity;
 *   2. GET /v4/twins, with the merchant account's token, gives that twin's API key;
 *   3. GET https://{twin}/dq/{dq}?apiKey=…            the twin's balance;
 *   4. POST https://{twin}/dq/{dq}/transfer?apiKey=…  the transfer, ONCE.
 *
 * WHO. `isEndToEndTestEmail` is the one place that decides who a test person is. This module
 * refuses everyone else before it asks Qatom anything, whatever the caller believes.
 *
 * THE KEY IS A SECRET, AND IT TRAVELS IN THE ADDRESS. So:
 *   - the twin's hostname and key are read at the moment of the refund, held in local
 *     variables for that one refund, and kept nowhere: nothing here is cached, returned,
 *     stored or logged;
 *   - before any call to a twin, the item's twin AND the recipient must both be wallet
 *     hostnames exactly as Qatom writes them (WALLET_HOSTNAME). That is what stops the key
 *     being sent to a host that is not a twin;
 *   - the address is never put in an error. Whatever the transport throws is replaced by an
 *     error that names the operation and, at most, a status.
 *
 * A DONATION THE PAID TESTS MAKE IS UNDONE THE SAME WAY (the same bullet of CLAUDE.md): it
 * goes back to the wallet it was paid from, which for a donation is the wallet the test
 * person paid the checkout page with, their primary wallet as a rule. That is
 * `returnTestDonationFromItemTwin` below. Both entrances run the one sender in this file, so
 * there is one copy of the checks and of the calls to a twin, and both refuse everyone who is
 * not a test person before anything is asked of Qatom.
 *
 * Nothing in this module logs.
 */
import type { AgentWalletHostname, PrimaryWalletHostname } from '@tejido/contracts';
import { z } from 'zod';
import {
	type QatomError,
	QatomHttpError,
	QatomNetworkError,
	QatomResponseError,
	QatomTimeoutError
} from '../errors.ts';
import { apiUrl, DEFAULT_TIMEOUT_MS, send, SLOW_TIMEOUT_MS } from '../http.ts';
import { fromQatomAmount, toQatomAmount } from './amounts.ts';

/**
 * The test inbox domain. A party is an end-to-end test person exactly when their email is at
 * this domain. Only people who can read that inbox can sign in as those accounts.
 */
export const E2E_TEST_EMAIL_DOMAIN = 'e2e.m.todaq.net';

/**
 * THE ONE PLACE that decides whether a party is an end-to-end test person: the part of their
 * email after its one `@` is exactly the test inbox domain, compared without regard to letter
 * case. A subdomain of it, a longer domain ending in it, or an address with two `@` is not.
 */
export function isEndToEndTestEmail(email: string): boolean {
	const at = email.indexOf('@');
	if (at <= 0 || at !== email.lastIndexOf('@')) return false;
	return email.slice(at + 1).toLowerCase() === E2E_TEST_EMAIL_DOMAIN;
}

/**
 * A wallet's hostname exactly as Qatom accepts it in an address. Lower case only: a hostname
 * in any other form is refused, not tidied.
 */
const WALLET_HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.biz\.todaq\.net$/;
const HOSTNAME_MAX_LENGTH = 253;

export function isWalletHostname(hostname: string): boolean {
	return hostname.length <= HOSTNAME_MAX_LENGTH && WALLET_HOSTNAME.test(hostname);
}

/** A digital quantity's hash: letters and digits only. It goes into a URL path. */
const DQ_HASH = /^[0-9a-zA-Z]+$/;

export interface ItemTwinRefundRequest {
	/** The commodity hash of the catalog item the deposits were paid for. */
	commodityHash: string;
	/** The party being paid back. Refused unless `email` is an end-to-end test person's. */
	party: { email: string; agentWalletHostname: AgentWalletHostname };
	/**
	 * A positive whole number in TEJIDO'S unit, thousandths of USD-TDN: `1000` sends 1.00. It
	 * goes to the twin as the decimal (`1`), converted in amounts.ts.
	 */
	amount: number;
	/**
	 * Called once, after every check has passed and immediately before the transfer, with the
	 * digital quantity about to be sent. This is where the caller records that money is about
	 * to move. Answer false and nothing is sent.
	 */
	beforeSending(dq: string): Promise<boolean>;
}

export interface ItemTwinDonationReturnRequest {
	/** The commodity hash of the DONATION item the donation was paid for. */
	commodityHash: string;
	/**
	 * The test person who paid the donation, and the wallet of theirs it was paid from: the
	 * caller has found that wallet on the item's ledger AND registered to them in Tejido's own
	 * database. Refused unless `email` is an end-to-end test person's.
	 */
	payer: { email: string; walletHostname: PrimaryWalletHostname | AgentWalletHostname };
	/** The donation's amount, in TEJIDO'S unit: `1000` sends 1.00. */
	amount: number;
	/** As in `ItemTwinRefundRequest`: called once, immediately before the transfer. */
	beforeSending(dq: string): Promise<boolean>;
}

/** Why nothing was sent. No request to move money was made. */
export type ItemTwinRefundRefusal =
	/** The party's email is not at the test inbox domain. */
	| 'not_a_test_person'
	/** The recipient's wallet is not a wallet hostname as Qatom writes one. */
	| 'recipient_not_a_wallet'
	/** The item's ledger did not name the twin the item is sold from. */
	| 'item_twin_not_named'
	/** The twin the ledger named is not a wallet hostname as Qatom writes one. */
	| 'item_twin_not_a_wallet'
	/** The item's twin and the recipient are the same wallet. */
	| 'recipient_is_the_item_twin'
	/** The item's ledger did not report a usable digital quantity. */
	| 'no_dq'
	/** The merchant account's list of twins does not hold the item's twin exactly once. */
	| 'item_twin_not_managed'
	/** Qatom withheld the twin's key (null or empty). */
	| 'item_twin_key_withheld'
	/** The twin holds less than the amount. */
	| 'item_twin_balance_too_low'
	/** `beforeSending` answered false. */
	| 'stopped_by_caller';

export type ItemTwinRefundResult =
	/** The twin answered OK: the money moved. */
	| { outcome: 'sent' }
	/** Nothing was sent, and no transfer was asked for. */
	| { outcome: 'not_sent'; reason: ItemTwinRefundRefusal }
	/**
	 * The transfer was sent once and the twin answered with a status that is not OK. Qatom's
	 * own server treats that as nothing having moved.
	 */
	| { outcome: 'refused'; status: number }
	/**
	 * The transfer was sent once and got no answer (a timeout, a dropped connection). The
	 * money MAY have moved. It is never sent again.
	 */
	| { outcome: 'unknown'; failure: 'timeout' | 'no_answer' };

export interface ItemTwinRefundDependencies {
	/** PAYMENT_API_URL */
	paymentApiUrl: string;
	/** Runs a call with the MERCHANT ACCOUNT's own token. Never a person's. */
	authorized<T>(call: (authorization: string) => Promise<T>): Promise<T>;
	/** The merchant account's ledger read, for the item's twin and digital quantity. */
	readItem(commodityHash: string): Promise<{ dq: string | null; twinHostname: string | null }>;
}

const twinsListingSchema = z.object({ twins: z.array(z.unknown()) });
// `key` is that twin's API key. Qatom can withhold it: null, empty or left out.
const listedTwinSchema = z.object({ hostname: z.string(), key: z.string().nullish() });
const balanceSchema = z.object({ balance: z.number() });

const OPERATION_TWINS = 'account.twins';
const OPERATION_BALANCE = 'account.item-twin-balance';

/**
 * The address of one call to a twin's own API. THE RESULT CARRIES THE KEY: it is handed to
 * `fetch` and to nothing else. Throws (without the key) if the address would not be exactly
 * the twin's own host over https.
 */
function twinUrl(hostname: string, path: string, key: string): URL {
	const url = new URL(`https://${hostname}${path}`);
	if (url.protocol !== 'https:' || url.hostname !== hostname || url.port !== '') {
		throw new TypeError('the twin address is not the twin over https');
	}
	url.searchParams.set('apiKey', key);
	return url;
}

/**
 * An error from a call to a twin, with nothing in it but the operation and a status. The
 * transport's own error may name the address (and so the key), and a twin's error body may
 * echo it, so neither the message, the `cause` nor Qatom's `error` fields are carried over.
 */
function withoutAddress(operation: string, error: unknown): QatomError {
	if (error instanceof QatomHttpError) return new QatomHttpError(operation, error.status);
	if (error instanceof QatomTimeoutError) return new QatomTimeoutError(operation, error.timeoutMs);
	if (error instanceof QatomResponseError) {
		return new QatomResponseError(operation, 'not the documented answer');
	}
	return new QatomNetworkError(operation, undefined);
}

/**
 * Refunds an END-TO-END TEST PERSON's deposits to their AGENT wallet, out of the twin the
 * item is sold from, by that twin's own API. Nobody else is ever refunded this way.
 *
 * The transfer is sent ONCE and never again, whatever the answer. Everything it reads from
 * Qatom about the twin (its hostname, its key) is used for this one refund and then dropped.
 *
 * Throws a QatomError only for a failure BEFORE the transfer (the ledger, the list of twins
 * or the balance could not be read): nothing was sent. What became of the transfer itself is
 * always in the result, never thrown.
 */
export function refundTestPersonFromItemTwin(
	deps: ItemTwinRefundDependencies,
	request: ItemTwinRefundRequest
): Promise<ItemTwinRefundResult> {
	return sendToTestPersonFromItemTwin(deps, {
		commodityHash: request.commodityHash,
		email: request.party.email,
		recipient: request.party.agentWalletHostname,
		amount: request.amount,
		beforeSending: request.beforeSending
	});
}

/**
 * Sends a donation an END-TO-END TEST PERSON paid back to the wallet they paid it from, out
 * of the donation item's own twin, by that twin's own API. Nobody else is ever sent money
 * this way. Everything said of `refundTestPersonFromItemTwin` holds: the same refusals in the
 * same order, one transfer, never again, nothing about the twin kept.
 */
export function returnTestDonationFromItemTwin(
	deps: ItemTwinRefundDependencies,
	request: ItemTwinDonationReturnRequest
): Promise<ItemTwinRefundResult> {
	return sendToTestPersonFromItemTwin(deps, {
		commodityHash: request.commodityHash,
		email: request.payer.email,
		recipient: request.payer.walletHostname,
		amount: request.amount,
		beforeSending: request.beforeSending
	});
}

/**
 * THE ONE SENDER. Not exported: the two functions above are the only ways in, and each names
 * the kind of wallet it may be given.
 */
async function sendToTestPersonFromItemTwin(
	deps: ItemTwinRefundDependencies,
	request: {
		commodityHash: string;
		email: string;
		recipient: string;
		amount: number;
		beforeSending(dq: string): Promise<boolean>;
	}
): Promise<ItemTwinRefundResult> {
	const notSent = (reason: ItemTwinRefundRefusal): ItemTwinRefundResult => ({
		outcome: 'not_sent',
		reason
	});

	// WHO, before anything is asked of Qatom.
	if (!isEndToEndTestEmail(request.email)) return notSent('not_a_test_person');
	const recipient = request.recipient;
	if (!isWalletHostname(recipient)) return notSent('recipient_not_a_wallet');

	// Our thousandths become the twin's decimal here: 1000 goes out as 1, 100 as 0.1. Throws
	// before anything is asked if the amount is not a positive whole number.
	const decimalAmount = toQatomAmount(request.amount);

	// 1. The twin the item is sold from, and the digital quantity, from the item's own ledger.
	const item = await deps.readItem(request.commodityHash);
	if (item.twinHostname === null) return notSent('item_twin_not_named');
	const twin = item.twinHostname;
	if (!isWalletHostname(twin)) return notSent('item_twin_not_a_wallet');
	if (twin === recipient) return notSent('recipient_is_the_item_twin');
	if (item.dq === null || !DQ_HASH.test(item.dq)) return notSent('no_dq');
	const dq = item.dq;

	// 2. That twin's key, from the merchant account's own list of twins. It lives in `key`
	//    until this function returns, and nowhere else.
	const listing = twinsListingSchema.safeParse(
		await deps.authorized((authorization) =>
			send({
				operation: OPERATION_TWINS,
				method: 'GET',
				url: apiUrl(deps.paymentApiUrl, '/v4/twins'),
				headers: { authorization },
				timeoutMs: DEFAULT_TIMEOUT_MS
			})
		)
	);
	if (!listing.success) throw new QatomResponseError(OPERATION_TWINS, 'twins is missing');
	const matches = listing.data.twins
		.map((raw) => listedTwinSchema.safeParse(raw))
		.filter((parsed) => parsed.success && parsed.data.hostname === twin);
	const [listed] = matches;
	if (matches.length !== 1 || !listed?.success) return notSent('item_twin_not_managed');
	const key = listed.data.key;
	if (key === null || key === undefined || key === '') return notSent('item_twin_key_withheld');

	// 3. The twin must hold the amount.
	let balance: number | null;
	try {
		const answer = balanceSchema.safeParse(
			await send({
				operation: OPERATION_BALANCE,
				method: 'GET',
				url: twinUrl(twin, `/dq/${dq}`, key),
				timeoutMs: DEFAULT_TIMEOUT_MS
			})
		);
		balance = answer.success ? fromQatomAmount(answer.data.balance) : null;
	} catch (error) {
		throw withoutAddress(OPERATION_BALANCE, error);
	}
	if (balance === null) throw new QatomResponseError(OPERATION_BALANCE, 'balance is missing');
	if (balance < request.amount) return notSent('item_twin_balance_too_low');

	// The caller records that money is about to move, or stops it.
	if (!(await request.beforeSending(dq))) return notSent('stopped_by_caller');

	// 4. THE TRANSFER, ONCE. An OK status means the money moved, whatever the body says, so
	//    the body is not read. `fetch` is called here, not through `send`, for that reason.
	let status: number;
	try {
		const response = await fetch(twinUrl(twin, `/dq/${dq}/transfer`, key), {
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			body: JSON.stringify({ amount: decimalAmount, destination: `https://${recipient}` }),
			// A redirect would carry the key somewhere we did not choose. It is an answer that
			// is not OK.
			redirect: 'manual',
			signal: AbortSignal.timeout(SLOW_TIMEOUT_MS)
		});
		status = response.status;
		// The answer is in the status. Dropping the body must not turn it into a failure.
		await response.body?.cancel().catch(() => undefined);
	} catch (error) {
		// Nothing of `error` is kept: its message may name the address.
		const timedOut =
			error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
		return { outcome: 'unknown', failure: timedOut ? 'timeout' : 'no_answer' };
	}
	if (status >= 200 && status <= 299) return { outcome: 'sent' };
	return { outcome: 'refused', status };
}
