/**
 * Donations: which amounts a donor can give, and the checkout link for one of them.
 *
 * Campaigns share Tejido's donation items: one catalog item per amount on the merchant
 * account. Nothing in our configuration or database names them. The server finds them by
 * asking Qatom for the account's own items and keeping the ones that are donation items:
 *
 *   - on sale;
 *   - its external endpoint is THIS site's `/api/donations/<amount>`, exactly, over https;
 *   - its price equals the amount in that address.
 *
 * The third rule is what makes a donation honest: the endpoint records the amount in the
 * address, the donor pays the item's price, and an item where the two differ is never offered.
 *
 * A checkout link is for ONE purchase, so one is made for every donor click and never stored.
 * Making one moves no money: nothing is charged until the donor pays on Qatom's page. Every
 * call here goes through the merchant account. No person's token is involved.
 */
import {
	AMOUNT_UNITS_PER_USD_TDN,
	donationInputSchema,
	type Amount,
	type DonationInput
} from '@tejido/contracts';
import type { Config } from '@tejido/config';
import type { MerchantAccount, OwnCatalogItem } from '@tejido/qatom/account';

/**
 * The amount an address segment stands for, in our units, or null when it names none: `5` is
 * 5.00 USD-TDN. Whole numbers from 1 to 999,999 only, written plainly: no sign, no decimals, no
 * leading zero. This reads our own address, not an amount from Qatom's API.
 */
export function donationAmountOf(segment: string): Amount | null {
	return /^[1-9][0-9]{0,5}$/.test(segment) ? Number(segment) * AMOUNT_UNITS_PER_USD_TDN : null;
}

/**
 * The origin the Campaign Site is served on, which is where the donation endpoint is. The
 * site's own sign-in callback is on it, so it is the origin of WEB_OIDC_REDIRECT_URI. There is
 * no separate configuration value for it.
 */
export function campaignSiteOrigin(config: Pick<Config, 'WEB_OIDC_REDIRECT_URI'>): string {
	return new URL(config.WEB_OIDC_REDIRECT_URI).origin;
}

/** One amount a donor can give, and the catalog item that sells it. */
export interface DonationOption {
	/** In our units: 5.00 USD-TDN is 5000. */
	amount: Amount;
	catalogItemId: number;
}

/**
 * The donation items among the account's own, smallest amount first. Reads and calls nothing.
 * When two items sell the same amount, the older one (the lower id) is used.
 */
export function donationOptions(
	items: readonly OwnCatalogItem[],
	siteOrigin: string
): DonationOption[] {
	const byAmount = new Map<Amount, number>();
	for (const item of items) {
		const endpoint = item.externalEndpoint === null ? null : URL.parse(item.externalEndpoint);
		if (!endpoint || endpoint.protocol !== 'https:' || endpoint.origin !== siteOrigin) continue;
		if (endpoint.search !== '' || endpoint.hash !== '') continue;
		const segment = /^\/api\/donations\/([^/]+)$/.exec(endpoint.pathname)?.[1];
		const amount = segment === undefined ? null : donationAmountOf(segment);
		// The price the donor pays must be the amount the endpoint records.
		if (amount === null || item.price !== amount) continue;
		const known = byAmount.get(amount);
		if (known === undefined || item.catalogItemId < known) {
			byAmount.set(amount, item.catalogItemId);
		}
	}
	return [...byAmount]
		.map(([amount, catalogItemId]) => ({ amount, catalogItemId }))
		.sort((a, b) => a.amount - b.amount);
}

type Account = Pick<MerchantAccount, 'listOwnCatalogItems' | 'createCheckout'>;

/** The amounts a donor can give right now, as Qatom lists them. Throws QatomError if it cannot. */
export async function listDonationOptions(
	account: Pick<Account, 'listOwnCatalogItems'>,
	config: Pick<Config, 'WEB_OIDC_REDIRECT_URI'>
): Promise<DonationOption[]> {
	return donationOptions(await account.listOwnCatalogItems(), campaignSiteOrigin(config));
}

/**
 * Makes the checkout link for one donation of `amount` to one campaign, or answers null when
 * no donation item sells that amount now. The items are looked up again here, so the item is
 * never taken from what a browser sent. Throws QatomError when Qatom cannot be asked.
 */
export async function startDonation(
	account: Account,
	config: Pick<Config, 'WEB_OIDC_REDIRECT_URI'>,
	donation: { campaignId: string; amount: Amount }
): Promise<{ url: string } | null> {
	const options = await listDonationOptions(account, config);
	const option = options.find((candidate) => candidate.amount === donation.amount);
	if (!option) return null;
	const inputs: DonationInput = donationInputSchema.parse({ campaign_id: donation.campaignId });
	return account.createCheckout({ catalogItemId: option.catalogItemId, inputs });
}
