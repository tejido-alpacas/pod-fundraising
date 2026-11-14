/**
 * Qatom identity 2 of 2: TEJIDO'S MERCHANT ACCOUNT.
 *
 * The account owns every campaign's catalog items, so only it can read their ledgers, and
 * refunds are paid from its wallet. It authenticates with its own client ID and secret
 * (QATOM_ACCOUNT_CLIENT_ID, QATOM_ACCOUNT_CLIENT_SECRET). Those are not the sign-in client's.
 *
 * Nothing here accepts a token from a caller. The account fetches and caches its own, so a
 * person's token cannot be used for a ledger read or a transfer. Server-side only.
 */
import type { PrimaryWalletHostname } from '@tejido/contracts';
import { z } from 'zod';
import { QatomHttpError, QatomResponseError, QatomUnknownCommodityError } from '../errors.ts';
import { apiUrl, DEFAULT_TIMEOUT_MS, send, SLOW_TIMEOUT_MS } from '../http.ts';

export interface MerchantAccountConfig {
	/** PAYMENT_API_URL */
	paymentApiUrl: string;
	/** QATOM_ACCOUNT_CLIENT_ID. The merchant account's, never OIDC_CLIENT_ID. */
	clientId: string;
	/** QATOM_ACCOUNT_CLIENT_SECRET */
	clientSecret: string;
}

/** One sale of a catalog item, as Qatom's ledger reports it. */
export interface LedgerTransaction {
	/** Identifies the entry in the twin's binder. */
	twistId: string;
	/** When the sale was recorded, as an ISO 8601 string. */
	timestamp: string;
	/**
	 * As the ledger reports it. Qatom's document does not state this field's unit. Prices and
	 * transfers are "in the smallest unit" of the digital quantity; confirm on staging that
	 * this is too before comparing it with a deposit.
	 */
	amount: number;
	/** `fromAddress`: the paying twin. Compare it with a party's agent wallet using `sameTwin`. */
	payingAddress: string;
	/** `destinationAddress`: the receiving twin. */
	receivingAddress: string;
}

export interface CommodityLedger {
	commodityHash: string;
	/**
	 * The digital quantity the commodity is priced in. A refund of deposits paid on this
	 * commodity is a transfer of this same quantity.
	 */
	dq: string | null;
	transactions: LedgerTransaction[];
	/**
	 * Rows Qatom returned without one of the five fields above. They are left out of
	 * `transactions` and counted here, because the API document marks none of them required.
	 */
	incompleteTransactions: number;
}

export type TransferDestination =
	/** Wallet to wallet. The type only admits a PRIMARY wallet: refunds never go to an agent wallet. */
	| { primaryWalletHostname: PrimaryWalletHostname }
	/** Qatom emails the person an invitation to claim the amount. */
	| { email: string };

export interface TransferRequest {
	to: TransferDestination;
	/** The digital quantity to send: `dq` from the ledger of the commodity being refunded. */
	dq: string;
	/** A positive whole number of the digital quantity's smallest unit. */
	amount: number;
	/** Shown to the recipient. Qatom cuts it to 280 characters. */
	note?: string;
}

export interface MerchantAccount {
	/**
	 * Turns a catalog item's commodity id into the commodity hash its ledger is read by.
	 * GET /v4/catalog/items?commodity_id=…&mine=true&active=all, with the account's own token.
	 *
	 * A commodity's hash never changes, so each answer is remembered for as long as this
	 * account object lives and Qatom is asked once per id. A failure is not remembered.
	 *
	 * Throws QatomUnknownCommodityError when Qatom lists no item for that id that the account
	 * may manage. Nothing is guessed in its place.
	 */
	resolveCommodityHash(commodityId: number): Promise<string>;

	/**
	 * Lists the transactions of one catalog item's commodity.
	 * GET /v4/commodity/{hash}/transactions. Only the commodity's owner may ask.
	 */
	listCommodityTransactions(commodityHash: string): Promise<CommodityLedger>;

	/**
	 * Sends an amount from the account's main wallet. POST /v4/transfer.
	 *
	 * Resolves once Qatom has accepted the transfer. Qatom returns no transaction id.
	 * It is never retried here, apart from once after a 401, where nothing has moved.
	 * If it throws QatomTimeoutError or QatomNetworkError the outcome is unknown: the money
	 * may have moved, so check before sending again. A 402 means the account's wallet could
	 * not cover the amount and nothing moved.
	 */
	transfer(request: TransferRequest): Promise<void>;
}

// Qatom returns a token with five minutes or more left as it is. Asking only in the last
// minute means the answer is always a new one.
const REFRESH_WHEN_LEFT_MS = 60_000;

const tokenResponseSchema = z.object({ access_token: z.string().min(1), expires_at: z.number() });

const catalogListingSchema = z.object({ items: z.array(z.unknown()) });

const catalogItemSchema = z.object({ commodity_id: z.number(), commodity_hash: z.string() });

const HASH = /^[0-9a-zA-Z]+$/;

const ledgerResponseSchema = z.object({
	commodity: z.object({ dq: z.string().optional() }).optional(),
	calculation: z.object({ transactions: z.array(z.unknown()) })
});

const ledgerTransactionSchema = z.object({
	twistId: z.string().min(1),
	timestamp: z.string().min(1),
	amount: z.number(),
	fromAddress: z.string().min(1),
	destinationAddress: z.string().min(1)
});

export function createMerchantAccount(config: MerchantAccountConfig): MerchantAccount {
	let cached: { token: string; expiresAtMs: number } | null = null;
	let fetching: Promise<string> | null = null;

	async function fetchToken(): Promise<string> {
		const operation = 'account.token';
		const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
		const body = await send({
			operation,
			method: 'POST',
			url: apiUrl(config.paymentApiUrl, '/v4/account/oauth/token'),
			headers: { authorization: `Basic ${basic}` },
			timeoutMs: DEFAULT_TIMEOUT_MS
		});
		const parsed = tokenResponseSchema.safeParse(body);
		if (!parsed.success) {
			throw new QatomResponseError(operation, 'access_token or expires_at is missing');
		}
		// "Unix time" in the document. Accept milliseconds too rather than misread an expiry.
		const { access_token, expires_at } = parsed.data;
		cached = {
			token: access_token,
			expiresAtMs: expires_at > 1e11 ? expires_at : expires_at * 1000
		};
		return access_token;
	}

	async function token(): Promise<string> {
		if (cached && cached.expiresAtMs - Date.now() > REFRESH_WHEN_LEFT_MS) return cached.token;
		// Concurrent callers share one request.
		fetching ??= fetchToken().finally(() => {
			fetching = null;
		});
		return fetching;
	}

	/** Runs a call with the account's token, fetching a new one once if Qatom answers 401. */
	async function authorized<T>(call: (authorization: string) => Promise<T>): Promise<T> {
		const first = await token();
		try {
			return await call(`Bearer ${first}`);
		} catch (error) {
			if (!(error instanceof QatomHttpError) || error.status !== 401) throw error;
			if (cached?.token === first) cached = null;
			return call(`Bearer ${await token()}`);
		}
	}

	// Commodity id to its hash. Holds the request while it is in flight, so callers that ask
	// together share one, and keeps the answer afterwards. A failed request is forgotten.
	const commodityHashes = new Map<number, Promise<string>>();

	async function fetchCommodityHash(commodityId: number): Promise<string> {
		const operation = 'account.commodity-hash';
		const url = apiUrl(config.paymentApiUrl, '/v4/catalog/items');
		url.searchParams.set('commodity_id', String(commodityId));
		// Only items the account may manage, on sale or not: a paused item still has a ledger.
		url.searchParams.set('mine', 'true');
		url.searchParams.set('active', 'all');

		const body = await authorized((authorization) =>
			send({
				operation,
				method: 'GET',
				url,
				headers: { authorization },
				timeoutMs: DEFAULT_TIMEOUT_MS
			})
		);
		const parsed = catalogListingSchema.safeParse(body);
		if (!parsed.success) throw new QatomResponseError(operation, 'items is missing');

		const hashes = new Set<string>();
		for (const raw of parsed.data.items) {
			const item = catalogItemSchema.safeParse(raw);
			if (!item.success) {
				throw new QatomResponseError(operation, 'an item has no commodity_id or commodity_hash');
			}
			// Trust the filter only as far as the answer shows it was applied.
			if (item.data.commodity_id !== commodityId) continue;
			if (!HASH.test(item.data.commodity_hash)) {
				throw new QatomResponseError(operation, 'commodity_hash is not letters and digits');
			}
			hashes.add(item.data.commodity_hash);
		}
		const [hash] = hashes;
		if (hash === undefined) throw new QatomUnknownCommodityError(operation, commodityId);
		if (hashes.size > 1) {
			throw new QatomResponseError(operation, 'more than one commodity_hash for one commodity_id');
		}
		return hash;
	}

	return {
		resolveCommodityHash(commodityId) {
			if (!Number.isSafeInteger(commodityId) || commodityId <= 0) {
				return Promise.reject(new RangeError('commodityId must be a positive whole number'));
			}
			let lookup = commodityHashes.get(commodityId);
			if (!lookup) {
				lookup = fetchCommodityHash(commodityId);
				commodityHashes.set(commodityId, lookup);
				lookup.catch(() => {
					if (commodityHashes.get(commodityId) === lookup) commodityHashes.delete(commodityId);
				});
			}
			return lookup;
		},

		async listCommodityTransactions(commodityHash) {
			const operation = 'account.ledger';
			if (!HASH.test(commodityHash)) {
				throw new TypeError('commodityHash must be letters and digits only');
			}
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'GET',
					url: apiUrl(config.paymentApiUrl, `/v4/commodity/${commodityHash}/transactions`),
					headers: { authorization },
					timeoutMs: SLOW_TIMEOUT_MS
				})
			);
			const parsed = ledgerResponseSchema.safeParse(body);
			if (!parsed.success) {
				throw new QatomResponseError(operation, 'calculation.transactions is missing');
			}

			const transactions: LedgerTransaction[] = [];
			let incompleteTransactions = 0;
			for (const raw of parsed.data.calculation.transactions) {
				const row = ledgerTransactionSchema.safeParse(raw);
				if (!row.success) {
					incompleteTransactions += 1;
					continue;
				}
				transactions.push({
					twistId: row.data.twistId,
					timestamp: row.data.timestamp,
					amount: row.data.amount,
					payingAddress: row.data.fromAddress,
					receivingAddress: row.data.destinationAddress
				});
			}
			return {
				commodityHash,
				dq: parsed.data.commodity?.dq ?? null,
				transactions,
				incompleteTransactions
			};
		},

		async transfer({ to, dq, amount, note }) {
			if (!Number.isSafeInteger(amount) || amount <= 0) {
				throw new RangeError('amount must be a positive whole number of the smallest unit');
			}
			if (!/^[0-9a-zA-Z]+$/.test(dq)) throw new TypeError('dq must be a digital quantity hash');

			// Qatom takes a twin URL (https:// and the hostname, nothing after) or an email address.
			const address =
				'primaryWalletHostname' in to ? `https://${to.primaryWalletHostname}` : to.email.trim();
			if (address === '' || /\s/.test(address)) throw new TypeError('the destination is empty');

			await authorized((authorization) =>
				send({
					operation: 'account.transfer',
					method: 'POST',
					url: apiUrl(config.paymentApiUrl, '/v4/transfer'),
					headers: { authorization },
					json: { address, type: dq, amount, ...(note ? { note } : {}) },
					timeoutMs: SLOW_TIMEOUT_MS
				})
			);
		}
	};
}
