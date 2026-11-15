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
import { fromQatomAmount, toQatomAmount } from './amounts.ts';
import {
	refundTestPersonFromItemTwin,
	returnTestDonationFromItemTwin,
	type ItemTwinDonationReturnRequest,
	type ItemTwinRefundRequest,
	type ItemTwinRefundResult
} from './item-twin-refund.ts';

export {
	E2E_TEST_EMAIL_DOMAIN,
	isEndToEndTestEmail,
	isWalletHostname,
	type ItemTwinDonationReturnRequest,
	type ItemTwinRefundRefusal,
	type ItemTwinRefundRequest,
	type ItemTwinRefundResult
} from './item-twin-refund.ts';

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
	 * In TEJIDO'S unit, whole thousandths of USD-TDN: a 0.10 sale is `100`. Qatom reports the
	 * decimal (`0.1`); it is converted in amounts.ts, so compare this with a deposit as it is.
	 */
	amount: number;
	/**
	 * `fromAddress`: the paying twin. NOT SETTLED which form Qatom uses: the one real row seen
	 * carries a 66-character hexadecimal address, not a hostname. Only a hostname or a twin URL
	 * can be compared with a party's agent wallet (`sameTwin`).
	 */
	payingAddress: string;
	/** `destinationAddress`: the receiving twin, or null when the row does not carry it. */
	receivingAddress: string | null;
	/**
	 * `operation`, as the row gives it, or null when the row carries none. Qatom's ledger lists
	 * `send`, `receive`, `transfer` and `split`.
	 */
	operation: string | null;
	/**
	 * `commodityHash`: the commodity the row itself names, or null when the row names none.
	 * Qatom's document lists the field without describing it. A row that names a commodity
	 * other than the one whose ledger was asked for is not a sale of that commodity.
	 */
	commodityHash: string | null;
}

export interface CommodityLedger {
	commodityHash: string;
	/**
	 * The digital quantity the commodity is priced in. A refund of deposits paid on this
	 * commodity is a transfer of this same quantity.
	 */
	dq: string | null;
	/**
	 * `commodity.hostname`: the twin that owns the commodity and is paid for it, or null when
	 * Qatom left it out. Compare it with a row's `receivingAddress` using `sameTwin` to tell a
	 * payment in from anything else.
	 */
	twinHostname: string | null;
	transactions: LedgerTransaction[];
	/**
	 * Rows Qatom returned without a `twistId`, `timestamp`, `amount` or `fromAddress`, or with
	 * an amount that does not convert to our unit. They are left out of `transactions` and
	 * counted here, because the API document marks none of them required.
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
	/**
	 * A positive whole number in TEJIDO'S unit, thousandths of USD-TDN: `1000` sends 1.00.
	 * It goes to Qatom as the decimal (`1`), converted in amounts.ts.
	 */
	amount: number;
	/** Shown to the recipient. Qatom cuts it to 280 characters. */
	note?: string;
}

/** A twin created to be paid for one catalog item. Its key is never read or kept. */
export interface ProviderTwin {
	/** Qatom's number for the twin: what a new commodity names as `twin_id`. */
	twinId: number;
	hostname: string;
}

/** A commodity as a twin's public listing shows it. The listing does not give its id. */
export interface TwinCommodity {
	hash: string;
	/** Null when the listing left the field out. */
	descriptor: string | null;
	/** The price in Tejido's unit (thousandths of USD-TDN), or null when the listing left it out. */
	cost: number | null;
	dq: string | null;
}

export interface NewCommodity {
	/** The twin that is paid. One priced item per twin: a twin holds one paywall configuration. */
	twinId: number;
	/** The line on the receipt. 1 to 255 characters. */
	descriptor: string;
	/**
	 * The price, a positive whole number in TEJIDO'S unit, thousandths of USD-TDN: `100` is a
	 * price of 0.10. It goes to Qatom as the decimal (`0.1`), converted in amounts.ts.
	 */
	cost: number;
	/** The digital quantity the price is in. */
	dq: string;
}

export interface NewCatalogItem {
	/** The commodity to sell, by its id (not its hash). */
	commodityId: number;
	/** The JSON Schema of the inputs a buyer supplies. */
	serviceSchema: { [key: string]: unknown };
	/** The https URL Qatom POSTs the inputs to after a purchase. No `{…}` placeholders. */
	externalEndpoint: string;
	/**
	 * A sensitive header Qatom sends with every call to the endpoint. The value goes to Qatom
	 * in this one request and nowhere else: it is not returned, kept or put in an error.
	 */
	secretHeader: { name: string; value: string };
}

/** A catalog item the merchant account may manage. */
export interface CatalogItem {
	catalogItemId: number;
	commodityId: number;
}

/** A catalog item the merchant account has on sale, with what a buyer pays and where it calls. */
export interface OwnCatalogItem {
	catalogItemId: number;
	/** The price in Tejido's whole thousandths, or null when Qatom gave none that can be used. */
	price: number | null;
	/** The URL Qatom calls after a sale, or null when the item calls nothing. */
	externalEndpoint: string | null;
	/** `commodity_id`: the commodity the item sells, or null when Qatom gave none usable. */
	commodityId: number | null;
	/**
	 * `commodity_hash`: what that commodity's ledger is read by (`listCommodityTransactions`),
	 * or null when Qatom gave none in the form a hash has.
	 */
	commodityHash: string | null;
}

export interface NewCheckout {
	/** The catalog item to sell. It must be on sale. */
	catalogItemId: number;
	/**
	 * The item's inputs, by name. The checkout page asks the shopper for nothing, so every
	 * input the item requires must be here. Qatom sends them to the item's endpoint once paid.
	 */
	inputs: { [name: string]: string | number | boolean };
}

/** A hosted checkout page for one purchase. */
export interface Checkout {
	/** Where to send the shopper. It can be paid once: make a new checkout for every purchase. */
	url: string;
}

/**
 * What Qatom's own record says about one purchase of a catalog item.
 *
 * It says that a sale happened, of which item, for how much and when it settled. It does NOT
 * say who paid: Qatom's purchase record names no payer.
 */
export type Purchase =
	/** Qatom has no purchase with this transaction id that the account may read. */
	| { status: 'not_found' }
	/** Qatom knows the purchase, and it has not settled (yet). */
	| { status: 'not_settled' }
	| {
			status: 'settled';
			/** The catalog item that was bought. */
			catalogItemId: number;
			/** The price paid, in TEJIDO'S unit, whole thousandths of USD-TDN: 0.100 is `100`. */
			amount: number;
			/** When the sale settled, as an ISO 8601 string in UTC. */
			settledAt: string;
	  };

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
	 * Sends an amount from the account's own wallet (its main account wallet first, not the
	 * wallets its items are sold from). POST /v4/transfer.
	 *
	 * Resolves once Qatom has accepted the transfer. Qatom returns no transaction id.
	 * It is sent ONCE and never again, whatever the answer: there is no retry after a 401
	 * either (see `transfer` below for why). If it throws QatomTimeoutError or
	 * QatomNetworkError the outcome is unknown: the money may have moved, so check before
	 * sending again. A 402 means the account's wallet could not cover the amount and nothing
	 * moved.
	 */
	transfer(request: TransferRequest): Promise<void>;

	/**
	 * Creates a provider twin for the merchant account, in one digital quantity.
	 * POST /v4/twin with `type: "provider"`.
	 *
	 * NOT repeatable: every call makes another twin, and nothing in Qatom's document lets a
	 * twin made here be found again afterwards. It is never retried here, apart from once
	 * after a 401, where nothing was made. After QatomTimeoutError, QatomNetworkError or a 5xx
	 * the outcome is unknown: a twin may exist.
	 */
	createProviderTwin(request: { dq: string }): Promise<ProviderTwin>;

	/**
	 * Lists what one twin sells. GET /v4/twin/{hostname}/commodities.
	 * Use it to see whether a commodity already exists on a twin before creating one.
	 */
	listTwinCommodities(hostname: string): Promise<TwinCommodity[]>;

	/**
	 * Creates a commodity on a twin and answers its hash. POST /v4/commodity.
	 *
	 * NOT repeatable: every call makes another commodity. Never retried here, apart from once
	 * after a 401. After a timeout, a network error or a 5xx the outcome is unknown: look with
	 * `listTwinCommodities` before creating again.
	 */
	createCommodity(request: NewCommodity): Promise<{ commodityHash: string }>;

	/**
	 * Sets a commodity's display name and description, and answers the commodity's id.
	 * PUT /v4/commodity/{hash}. The name becomes the item's tool name on the MCP server.
	 *
	 * Creating a commodity returns only its hash; this answer is where Qatom's document gives
	 * the id a catalog item is created with. Sending the same name and description again
	 * changes nothing, so this call may be repeated.
	 */
	describeCommodity(
		commodityHash: string,
		text: { name: string; description: string }
	): Promise<{ commodityId: number }>;

	/**
	 * The catalog item selling a commodity, on sale or not, or null when there is none that the
	 * account may manage. GET /v4/catalog/items?commodity_id=…&mine=true&active=all.
	 * Use it to see whether an item already exists before creating one.
	 */
	findCatalogItem(commodityId: number): Promise<CatalogItem | null>;

	/**
	 * Puts a commodity on sale as a catalog item that POSTs to `externalEndpoint`, featured (a
	 * tool on the account's managed MCP server), with its secret header written in the same
	 * step. POST /v4/catalog/items.
	 *
	 * NOT repeatable. Never retried here, apart from once after a 401. Qatom's document says a
	 * 400, 403, 409, 502 or 503 means nothing was created; a 500 is also what it answers when
	 * the commodity already has an item. After a timeout, a network error or a 500 the outcome
	 * is unknown: look with `findCatalogItem` before creating again.
	 */
	createCatalogItem(request: NewCatalogItem): Promise<CatalogItem>;

	/**
	 * Looks up one purchase of one of the account's catalog items by the transaction id Qatom
	 * sent with the sale (the `X-Qatom-Transaction-Id` header of its call to the item's
	 * endpoint). GET /v4/catalog/purchases/{transaction_id}, with the account's own token:
	 * only the item's manager may ask.
	 *
	 * It only reads. A 404 is `not_found`; a purchase with no settled time is `not_settled`.
	 * The answer never says who paid.
	 */
	getPurchase(transactionId: string): Promise<Purchase>;

	/**
	 * Every catalog item the account has on sale, oldest first, with its price and the URL it
	 * calls. GET /v4/catalog/items?mine=true&active=true. Qatom's document says a `mine`
	 * listing is not paged, and that `external_endpoint` is given on items the caller manages.
	 * It only reads.
	 */
	listOwnCatalogItems(): Promise<OwnCatalogItem[]>;

	/**
	 * Makes a hosted checkout page for one purchase of one catalog item, and answers its link.
	 * POST /v4/payment/checkout. Nothing is charged until the shopper pays on that page.
	 *
	 * It moves no money and makes nothing that is for sale, so calling it again is harmless:
	 * each call makes another link. Qatom answers 400 when the item is not on sale or a required
	 * input is missing (QatomHttpError).
	 */
	createCheckout(request: NewCheckout): Promise<Checkout>;

	/**
	 * FOR THE END-TO-END TEST PEOPLE ONLY: sends a test person's deposits back to their AGENT
	 * wallet, out of the twin the item is sold from, by that twin's own API. The one exception
	 * to "refunds go to the primary wallet only"; see item-twin-refund.ts for the rules.
	 *
	 * It refuses a party whose email is not at the test inbox domain. The transfer is sent
	 * ONCE and never again. The twin's hostname and key are read from Qatom for this one call
	 * and are not kept, returned or logged.
	 */
	refundTestPersonFromItemTwin(request: ItemTwinRefundRequest): Promise<ItemTwinRefundResult>;

	/**
	 * FOR THE END-TO-END TEST PEOPLE ONLY: sends a donation a test person paid back to the
	 * wallet they paid it from (primary or agent), out of the donation item's own twin, by that
	 * twin's own API. Part of the same one exception; see item-twin-refund.ts for the rules.
	 *
	 * It refuses a payer whose email is not at the test inbox domain. The transfer is sent
	 * ONCE and never again. The twin's hostname and key are read from Qatom for this one call
	 * and are not kept, returned or logged.
	 */
	returnTestDonationFromItemTwin(
		request: ItemTwinDonationReturnRequest
	): Promise<ItemTwinRefundResult>;
}

// Qatom returns a token with five minutes or more left as it is. Asking only in the last
// minute means the answer is always a new one.
const REFRESH_WHEN_LEFT_MS = 60_000;

// Qatom's document shows `expires_at` as a number. The server sends a string of digits (it
// comes straight from a 64-bit database column). Either is read; anything else is refused.
const tokenResponseSchema = z.object({
	access_token: z.string().min(1),
	expires_at: z.union([z.number(), z.string().regex(/^[0-9]{1,15}$/)])
});

const catalogListingSchema = z.object({ items: z.array(z.unknown()) });

const catalogItemSchema = z.object({ commodity_id: z.number(), commodity_hash: z.string() });

/** A digital quantity's hash: letters and digits only. */
const HASH = /^[0-9a-zA-Z]+$/;

/**
 * A commodity's hash. On the server it is a UUID with hyphens, for example
 * `3f2b8c1e-5d47-4a9b-8e21-0c6d9f4a7b12`; Qatom's document does not say so. Letters and digits
 * alone are still accepted. Nothing else is: the hash goes into a URL path.
 */
const COMMODITY_HASH =
	/^(?:[0-9a-zA-Z]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const NOT_A_COMMODITY_HASH = 'commodityHash must be a UUID, or letters and digits only';

const ledgerResponseSchema = z.object({
	commodity: z.object({ dq: z.string().optional(), hostname: z.string().optional() }).optional(),
	calculation: z.object({ transactions: z.array(z.unknown()) })
});

const ledgerTransactionSchema = z.object({
	twistId: z.string().min(1),
	timestamp: z.string().min(1),
	// Decimal USD-TDN. Converted to our unit where the row is read.
	amount: z.number(),
	fromAddress: z.string().min(1),
	// Real rows may not carry it, and only funding reads it.
	destinationAddress: z.string().min(1).optional(),
	operation: z.string().min(1).optional(),
	commodityHash: z.string().min(1).optional()
});

// The 201 of POST /v4/twin also carries the twin's `key`, a secret. It is not read.
const twinResponseSchema = z.object({ id: z.number().int().positive(), hostname: z.string() });

const HOSTNAME = /^[0-9a-z]([0-9a-z.-]*[0-9a-z])?$/;

const twinCommoditySchema = z.object({
	hash: z.string(),
	descriptor: z.string().optional(),
	cost: z.number().optional(),
	dq: z.string().optional()
});

const createdCommoditySchema = z.object({ hash: z.string() });

const updatedCommoditySchema = z.object({
	commodity: z.object({ id: z.number().int().positive(), hash: z.string() })
});

/** Qatom's transaction id: a UUID. It goes into a URL path. */
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `amount` is a string with three decimals ("0.100"), as Qatom's server sends it. `settled_at`
// is a date-time, and is null or left out while the sale has not settled.
const purchaseSchema = z.object({
	purchase: z.object({
		transaction_id: z.string(),
		catalog_item_id: z.number().int().positive(),
		amount: z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/),
		settled_at: z.string().nullish()
	})
});

const managedItemSchema = z.object({
	id: z.number().int().positive(),
	commodity_id: z.number().int().positive()
});

const createdItemSchema = z.object({ item: managedItemSchema });

const ownItemSchema = z.object({
	id: z.number().int().positive(),
	active: z.boolean().optional(),
	commodity_cost: z.unknown().optional(),
	external_endpoint: z.string().nullish(),
	// Read leniently: an item whose commodity is given in another form is still an item.
	commodity_id: z.unknown().optional(),
	commodity_hash: z.unknown().optional()
});

// The 201 of POST /v4/payment/checkout also carries the checkout's `hash`. Whoever holds it
// can pay the checkout, and it is already in `url`. It is not read.
const checkoutSchema = z.object({ url: z.string() });

// Qatom: a header value is 1 to 4096 printable ASCII characters, not starting or ending with a space.
const HEADER_NAME = /^[0-9A-Za-z_-]{1,64}$/;
const HEADER_VALUE = /^[\x21-\x7e]([\x20-\x7e]{0,4094}[\x21-\x7e])?$/;

function isId(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

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
		const { access_token } = parsed.data;
		const expires_at = Number(parsed.data.expires_at);
		if (!Number.isSafeInteger(expires_at) || expires_at <= 0) {
			throw new QatomResponseError(operation, 'expires_at is not a time');
		}
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
			if (!COMMODITY_HASH.test(item.data.commodity_hash)) {
				throw new QatomResponseError(
					operation,
					'commodity_hash is not a UUID or letters and digits'
				);
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

	const account: MerchantAccount = {
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
			if (!COMMODITY_HASH.test(commodityHash)) throw new TypeError(NOT_A_COMMODITY_HASH);
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
				const amount = row.success ? fromQatomAmount(row.data.amount) : null;
				if (!row.success || amount === null) {
					incompleteTransactions += 1;
					continue;
				}
				transactions.push({
					twistId: row.data.twistId,
					timestamp: row.data.timestamp,
					amount,
					payingAddress: row.data.fromAddress,
					receivingAddress: row.data.destinationAddress ?? null,
					operation: row.data.operation ?? null,
					commodityHash: row.data.commodityHash ?? null
				});
			}
			return {
				commodityHash,
				dq: parsed.data.commodity?.dq ?? null,
				twinHostname: parsed.data.commodity?.hostname || null,
				transactions,
				incompleteTransactions
			};
		},

		async transfer({ to, dq, amount, note }) {
			// Our thousandths become Qatom's decimal here: 1000 goes out as 1, 100 as 0.1. Qatom
			// would send whatever number it is given, so this throws before anything is sent.
			const decimalAmount = toQatomAmount(amount);
			if (!HASH.test(dq)) throw new TypeError('dq must be a digital quantity hash');

			// Qatom takes a twin URL (https:// and the hostname, nothing after) or an email address.
			const address =
				'primaryWalletHostname' in to ? `https://${to.primaryWalletHostname}` : to.email.trim();
			if (address === '' || /\s/.test(address)) throw new TypeError('the destination is empty');

			// SENT ONCE. This call does not go through `authorized`, which repeats a request after
			// a 401. On this route Qatom's server answers 403, not 401, for a bad or expired token;
			// a 401 here can only be the wallet's own refusal passed through, so repeating after
			// it would be sending a transfer twice. A transfer is never sent again for any reason.
			const used = await token();
			try {
				await send({
					operation: 'account.transfer',
					method: 'POST',
					url: apiUrl(config.paymentApiUrl, '/v4/transfer'),
					headers: { authorization: `Bearer ${used}` },
					json: { address, type: dq, amount: decimalAmount, ...(note ? { note } : {}) },
					timeoutMs: SLOW_TIMEOUT_MS
				});
			} catch (error) {
				// A 403 may mean the token was refused. Forget it, so the NEXT call asks for a new
				// one. This transfer is not repeated.
				if (error instanceof QatomHttpError && error.status === 403 && cached?.token === used) {
					cached = null;
				}
				throw error;
			}
		},

		async createProviderTwin({ dq }) {
			const operation = 'account.create-twin';
			if (!HASH.test(dq)) throw new TypeError('dq must be a digital quantity hash');
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'POST',
					url: apiUrl(config.paymentApiUrl, '/v4/twin'),
					headers: { authorization },
					json: { dq, type: 'provider' },
					timeoutMs: SLOW_TIMEOUT_MS
				})
			);
			const parsed = twinResponseSchema.safeParse(body);
			if (!parsed.success || !HOSTNAME.test(parsed.data.hostname)) {
				throw new QatomResponseError(operation, 'id or hostname is missing');
			}
			return { twinId: parsed.data.id, hostname: parsed.data.hostname };
		},

		async listTwinCommodities(hostname) {
			const operation = 'account.twin-commodities';
			if (!HOSTNAME.test(hostname)) throw new TypeError('hostname must be a twin hostname');
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'GET',
					url: apiUrl(config.paymentApiUrl, `/v4/twin/${hostname}/commodities`),
					headers: { authorization },
					timeoutMs: DEFAULT_TIMEOUT_MS
				})
			);
			const parsed = z.array(twinCommoditySchema).safeParse(body);
			if (
				!parsed.success ||
				parsed.data.some((commodity) => !COMMODITY_HASH.test(commodity.hash))
			) {
				throw new QatomResponseError(operation, 'not a list of commodities with a hash each');
			}
			return parsed.data.map((commodity) => {
				// Qatom lists the price in decimal USD-TDN. Callers get our unit.
				const cost = commodity.cost === undefined ? null : fromQatomAmount(commodity.cost);
				if (commodity.cost !== undefined && cost === null) {
					throw new QatomResponseError(operation, 'a cost is not an amount');
				}
				return {
					hash: commodity.hash,
					descriptor: commodity.descriptor ?? null,
					cost,
					dq: commodity.dq ?? null
				};
			});
		},

		async createCommodity({ twinId, descriptor, cost, dq }) {
			const operation = 'account.create-commodity';
			if (!isId(twinId)) throw new RangeError('twinId must be a positive whole number');
			// Our thousandths become Qatom's decimal here: a cost of 100 is stored as 0.1.
			const decimalCost = toQatomAmount(cost);
			if (!HASH.test(dq)) throw new TypeError('dq must be a digital quantity hash');
			if (descriptor.length < 1 || descriptor.length > 255) {
				throw new RangeError('descriptor must be 1 to 255 characters');
			}
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'POST',
					url: apiUrl(config.paymentApiUrl, '/v4/commodity'),
					headers: { authorization },
					json: { descriptor, cost: decimalCost, dq, twin_id: twinId },
					timeoutMs: SLOW_TIMEOUT_MS
				})
			);
			const parsed = createdCommoditySchema.safeParse(body);
			if (!parsed.success || !COMMODITY_HASH.test(parsed.data.hash)) {
				throw new QatomResponseError(operation, 'hash is missing');
			}
			return { commodityHash: parsed.data.hash };
		},

		async describeCommodity(commodityHash, { name, description }) {
			const operation = 'account.describe-commodity';
			if (!COMMODITY_HASH.test(commodityHash)) throw new TypeError(NOT_A_COMMODITY_HASH);
			if (name.trim() === '' || description.trim() === '') {
				throw new RangeError('name and description must not be empty');
			}
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'PUT',
					url: apiUrl(config.paymentApiUrl, `/v4/commodity/${commodityHash}`),
					headers: { authorization },
					json: { name, description },
					timeoutMs: SLOW_TIMEOUT_MS
				})
			);
			const parsed = updatedCommoditySchema.safeParse(body);
			if (!parsed.success) throw new QatomResponseError(operation, 'commodity.id is missing');
			if (parsed.data.commodity.hash !== commodityHash) {
				throw new QatomResponseError(operation, 'the answer is about another commodity');
			}
			return { commodityId: parsed.data.commodity.id };
		},

		async findCatalogItem(commodityId) {
			const operation = 'account.find-item';
			if (!isId(commodityId)) throw new RangeError('commodityId must be a positive whole number');
			const url = apiUrl(config.paymentApiUrl, '/v4/catalog/items');
			url.searchParams.set('commodity_id', String(commodityId));
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
			const listing = catalogListingSchema.safeParse(body);
			if (!listing.success) throw new QatomResponseError(operation, 'items is missing');

			const found: CatalogItem[] = [];
			for (const raw of listing.data.items) {
				const item = managedItemSchema.safeParse(raw);
				if (!item.success) {
					throw new QatomResponseError(operation, 'an item has no id or commodity_id');
				}
				// Trust the filter only as far as the answer shows it was applied.
				if (item.data.commodity_id !== commodityId) continue;
				found.push({ catalogItemId: item.data.id, commodityId });
			}
			if (found.length > 1) {
				throw new QatomResponseError(operation, 'more than one item for one commodity_id');
			}
			return found[0] ?? null;
		},

		async createCatalogItem({ commodityId, serviceSchema, externalEndpoint, secretHeader }) {
			const operation = 'account.create-item';
			if (!isId(commodityId)) throw new RangeError('commodityId must be a positive whole number');
			const endpoint = URL.parse(externalEndpoint);
			if (endpoint?.protocol !== 'https:' || /[{}]/.test(externalEndpoint)) {
				throw new TypeError('externalEndpoint must be an https URL with no placeholders');
			}
			if (!HEADER_NAME.test(secretHeader.name) || !HEADER_VALUE.test(secretHeader.value)) {
				// Says nothing about the value itself.
				throw new TypeError('secretHeader is not a header name and value Qatom accepts');
			}
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'POST',
					url: apiUrl(config.paymentApiUrl, '/v4/catalog/items'),
					headers: { authorization },
					json: {
						commodity_id: commodityId,
						service_method: 'POST',
						service_schema: serviceSchema,
						external_endpoint: externalEndpoint,
						active: true,
						featured: true,
						dispatch_params: [
							{
								kind: 'header',
								name: secretHeader.name,
								sensitive: true,
								value: secretHeader.value
							}
						]
					},
					timeoutMs: SLOW_TIMEOUT_MS
				})
			);
			const parsed = createdItemSchema.safeParse(body);
			if (!parsed.success) {
				throw new QatomResponseError(operation, 'item.id or item.commodity_id is missing');
			}
			if (parsed.data.item.commodity_id !== commodityId) {
				throw new QatomResponseError(operation, 'the item is for another commodity');
			}
			return { catalogItemId: parsed.data.item.id, commodityId };
		},

		async listOwnCatalogItems() {
			const operation = 'account.own-items';
			const url = apiUrl(config.paymentApiUrl, '/v4/catalog/items');
			url.searchParams.set('mine', 'true');
			url.searchParams.set('active', 'true');
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'GET',
					url,
					headers: { authorization },
					timeoutMs: DEFAULT_TIMEOUT_MS
				})
			);
			const listing = catalogListingSchema.safeParse(body);
			if (!listing.success) throw new QatomResponseError(operation, 'items is missing');

			const items: OwnCatalogItem[] = [];
			for (const raw of listing.data.items) {
				const item = ownItemSchema.safeParse(raw);
				if (!item.success) throw new QatomResponseError(operation, 'an item has no id');
				// Trust the filter only as far as the answer shows it was applied.
				if (item.data.active === false) continue;
				const price = fromQatomAmount(item.data.commodity_cost);
				const { commodity_id: commodityId, commodity_hash: commodityHash } = item.data;
				items.push({
					catalogItemId: item.data.id,
					price: price !== null && price > 0 ? price : null,
					externalEndpoint: item.data.external_endpoint || null,
					commodityId: typeof commodityId === 'number' && isId(commodityId) ? commodityId : null,
					commodityHash:
						typeof commodityHash === 'string' && COMMODITY_HASH.test(commodityHash)
							? commodityHash
							: null
				});
			}
			return items;
		},

		async createCheckout({ catalogItemId, inputs }) {
			const operation = 'account.create-checkout';
			if (!isId(catalogItemId)) {
				throw new RangeError('catalogItemId must be a positive whole number');
			}
			const body = await authorized((authorization) =>
				send({
					operation,
					method: 'POST',
					url: apiUrl(config.paymentApiUrl, '/v4/payment/checkout'),
					headers: { authorization },
					json: { catalog_item_id: catalogItemId, arguments: inputs },
					timeoutMs: DEFAULT_TIMEOUT_MS
				})
			);
			const parsed = checkoutSchema.safeParse(body);
			const link = parsed.success ? URL.parse(parsed.data.url) : null;
			// The shopper's browser is sent here, so it must be a plain https link.
			if (link?.protocol !== 'https:' || link.username !== '' || link.password !== '') {
				throw new QatomResponseError(operation, 'url is missing or is not an https link');
			}
			return { url: link.href };
		},

		async getPurchase(transactionId) {
			const operation = 'account.purchase';
			if (!TRANSACTION_ID.test(transactionId)) {
				throw new TypeError('transactionId must be a UUID');
			}
			let body: unknown;
			try {
				body = await authorized((authorization) =>
					send({
						operation,
						method: 'GET',
						url: apiUrl(config.paymentApiUrl, `/v4/catalog/purchases/${transactionId}`),
						headers: { authorization },
						timeoutMs: DEFAULT_TIMEOUT_MS
					})
				);
			} catch (error) {
				if (error instanceof QatomHttpError && error.status === 404) {
					return { status: 'not_found' };
				}
				throw error;
			}
			const parsed = purchaseSchema.safeParse(body);
			if (!parsed.success) {
				throw new QatomResponseError(operation, 'not a purchase with an item and an amount');
			}
			const { purchase } = parsed.data;
			if (purchase.transaction_id.toLowerCase() !== transactionId.toLowerCase()) {
				throw new QatomResponseError(operation, 'the answer is about another purchase');
			}
			if (purchase.settled_at === null || purchase.settled_at === undefined) {
				return { status: 'not_settled' };
			}
			const settledAtMs = Date.parse(purchase.settled_at);
			// Decimal USD-TDN becomes our thousandths in amounts.ts, the one place that converts.
			const amount = fromQatomAmount(Number(purchase.amount));
			if (Number.isNaN(settledAtMs) || amount === null || amount <= 0) {
				throw new QatomResponseError(operation, 'settled_at or amount cannot be read');
			}
			return {
				status: 'settled',
				catalogItemId: purchase.catalog_item_id,
				amount,
				settledAt: new Date(settledAtMs).toISOString()
			};
		},

		refundTestPersonFromItemTwin(request) {
			return refundTestPersonFromItemTwin(
				{
					paymentApiUrl: config.paymentApiUrl,
					authorized,
					readItem: (commodityHash) => account.listCommodityTransactions(commodityHash)
				},
				request
			);
		},

		returnTestDonationFromItemTwin(request) {
			return returnTestDonationFromItemTwin(
				{
					paymentApiUrl: config.paymentApiUrl,
					authorized,
					readItem: (commodityHash) => account.listCommodityTransactions(commodityHash)
				},
				request
			);
		}
	};
	return account;
}
