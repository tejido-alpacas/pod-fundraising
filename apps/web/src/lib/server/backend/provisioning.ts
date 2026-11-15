/**
 * Item provisioning (C7): creates a campaign's two catalog items in Qatom, "Log work" and
 * "Milestone hit", and stores their commodity ids on the campaign. It replaces the step that
 * is done by hand in Qatom's dashboard. Track C owns this file.
 *
 * Everything here goes through Tejido's merchant account. No person's token is involved.
 *
 * WRITTEN FROM QATOM'S API DOCUMENT AND NOT YET RUN AGAINST QATOM. See the list at the end
 * of this comment for what the document does not settle.
 *
 * What is created for each item, in this order:
 *
 *   1. a provider twin of its own       POST /v4/twin
 *   2. a commodity on it, with the price POST /v4/commodity          (answers its hash)
 *   3. its name and description          PUT  /v4/commodity/{hash}   (answers its id)
 *   4. the catalog item, featured, with  POST /v4/catalog/items
 *      our check-in endpoint and the
 *      secret header, in one request
 *
 * Each item gets its own twin because Qatom says a twin holds one paywall configuration, so
 * two priced items on one twin would share a price and an endpoint.
 *
 * HOW IT IS SAFE TO RUN TWICE
 *
 * - An item whose commodity id is already on the campaign is left alone: nothing is sent.
 * - Progress is saved after every step (the `item_provisioning` table), so a run that stopped
 *   part-way continues from the step it stopped at.
 * - Only one run at a time works on an item: it takes a ten-minute lease first.
 * - Before creating a commodity it asks Qatom what the twin already sells, and before
 *   creating a catalog item it asks whether the commodity already has one. If it is there,
 *   it is adopted, not created again. That is what settles a call whose answer never arrived.
 * - A create call is sent once and never repeated by this code. If it ends without a clear
 *   answer (a timeout, a dropped connection, a server error), the outcome is unknown, so the
 *   lease is NOT given back: for ten minutes further runs answer `busy`, which gives Qatom
 *   time to finish. The run after that looks first, as above.
 * - If Qatom clearly refused (a 4xx; for the catalog item also 502 and 503, which its
 *   document says create nothing), the lease is given back and the next run may try at once.
 *
 * The one thing that cannot be looked up is a twin: Qatom's document gives no way to
 * recognise a twin we made. So if creating the twin ends without an answer, the next run
 * makes another, and the first, if it exists, is left unused. An unused twin holds no money
 * and sells nothing. The report says so when it may have happened.
 *
 * WHAT QATOM'S DOCUMENT DOES NOT SETTLE (not guessed here; see the pull request)
 *
 * - Which digital quantity is USD-TDN. The caller names it (`dq`).
 * - The scale of a price. It uses DEPOSIT_AMOUNT, the same assumption as the rest of the code.
 * - Whether the merchant account's token may create a provider twin.
 * - The longest description Qatom accepts. The team's limit of 1024 characters is enforced.
 */
import {
	CHECKIN_SECRET_HEADER,
	DEPOSIT_AMOUNT,
	formatAmount,
	itemInputJsonSchema,
	type Campaign,
	type EntryItem
} from '@tejido/contracts';
import {
	claimItemProvisioning,
	finishItemProvisioning,
	getCampaign,
	listMilestones,
	releaseItemProvisioning,
	saveItemProvisioningProgress,
	type Database,
	type ItemProvisioning
} from '@tejido/db';
import { QatomError, QatomHttpError } from '@tejido/qatom';
import type { MerchantAccount } from '@tejido/qatom/account';

/** How long one run may hold an item, and how long an unclear answer blocks the next run. */
export const PROVISIONING_LEASE_MS = 10 * 60 * 1000;

/** The team's limit for an item's description. */
export const MAX_DESCRIPTION_LENGTH = 1024;

const ITEMS = ['log_work', 'milestone_hit'] as const satisfies readonly EntryItem[];

export interface ProvisionRequest {
	db: Database;
	/** Tejido's merchant account. Never a person's sign-in. */
	account: MerchantAccount;
	campaignId: string;
	/** The digital quantity the two prices are in: the hash Qatom lists for USD-TDN. */
	dq: string;
	/** Where Qatom is to POST each purchase: `https://<this site>/api/checkins`. */
	checkinEndpoint: string;
	/** CHECKIN_SHARED_SECRET. Sent to Qatom as the item's secret header and kept nowhere. */
	checkinSecret: string;
}

export type ItemOutcome =
	/** The campaign already had this item's commodity id. Nothing was sent to Qatom. */
	| 'already_provisioned'
	/** The item now exists and its commodity id is on the campaign. */
	| 'provisioned'
	/** Another run holds this item, or an earlier one ended without a clear answer. Wait. */
	| 'busy'
	/** A step failed. `problem` says which; `retry` says when trying again is safe. */
	| 'failed'
	/** Not attempted, because the item before it did not finish. */
	| 'not_attempted';

export interface ItemReport {
	item: EntryItem;
	outcome: ItemOutcome;
	commodityId: number | null;
	/** What this run did for the item, in order, in plain words. */
	steps: string[];
	problem?: string;
	/** `now`: Qatom refused and nothing was made. `after_wait`: unclear, wait for the lease. */
	retry?: 'now' | 'after_wait';
}

export type ProvisionResult =
	| { ok: true; campaignId: string; provisioned: boolean; items: ItemReport[] }
	| { ok: false; httpStatus: number; error: string; message: string };

/** The name, receipt line and description of one item. The name becomes the tool's name. */
export function itemText(
	campaign: Pick<Campaign, 'title'>,
	item: EntryItem
): { name: string; description: string } {
	const price = formatAmount(DEPOSIT_AMOUNT[item]);
	const text =
		item === 'log_work'
			? {
					name: `${campaign.title} log work`,
					description:
						`File a routine work log for the Tejido campaign "${campaign.title}": what was done in ` +
						`this period, how far the milestone is, and photos uploaded to Tejido first. ` +
						`The price of ${price} is a deposit, returned when the milestone is confirmed. ` +
						`You need the private reporter code from your Tejido invite.`
				}
			: {
					name: `${campaign.title} milestone hit`,
					description:
						`Claim that a milestone of the Tejido campaign "${campaign.title}" is done, with its ` +
						`evidence, or, as its named confirmer, sign it off with claim "confirm". ` +
						`The price of ${price} is a deposit, returned when the milestone is confirmed. ` +
						`You need the private reporter code from your Tejido invite.`
				};
	if (text.description.length > MAX_DESCRIPTION_LENGTH || text.name.length > 255) {
		throw new RangeError('The item text is too long for Qatom.');
	}
	return text;
}

function refuse(httpStatus: number, error: string, message: string): ProvisionResult {
	return { ok: false, httpStatus, error, message };
}

const timestamp = (ms: number) => new Date(ms).toISOString();

export async function provisionCampaignItems(request: ProvisionRequest): Promise<ProvisionResult> {
	const { db, campaignId } = request;

	const endpoint = URL.parse(request.checkinEndpoint);
	if (endpoint?.protocol !== 'https:') {
		return refuse(
			409,
			'endpoint_not_https',
			'Refused: the check-in address Qatom would call is not an https address. Call this on the deployed site, not on a local one.'
		);
	}
	if (!/^[0-9a-zA-Z]+$/.test(request.dq)) {
		return refuse(422, 'invalid_inputs', 'Refused: dq must be a digital quantity hash.');
	}

	const campaign = await getCampaign(db, campaignId);
	if (!campaign) return refuse(404, 'unknown_campaign', `No campaign "${campaignId}".`);
	if (campaign.status === 'draft' || campaign.status === 'funding') {
		return refuse(
			409,
			'not_funded',
			`Refused: the campaign is still "${campaign.status}". Items are created once it has reached its goal.`
		);
	}
	if ((await listMilestones(db, campaignId)).length === 0) {
		return refuse(409, 'no_milestones', 'Refused: the campaign has no milestones to report on.');
	}

	const items: ItemReport[] = [];
	let stopped = false;
	for (const item of ITEMS) {
		if (stopped) {
			items.push({ item, outcome: 'not_attempted', commodityId: null, steps: [] });
			continue;
		}
		const report = await provisionItem(request, campaign, item);
		items.push(report);
		stopped = report.outcome === 'busy' || report.outcome === 'failed';
	}

	return {
		ok: true,
		campaignId,
		provisioned: items.every(
			(report) => report.outcome === 'provisioned' || report.outcome === 'already_provisioned'
		),
		items
	};
}

async function provisionItem(
	request: ProvisionRequest,
	campaign: Campaign,
	item: EntryItem
): Promise<ItemReport> {
	const { db, account, campaignId, dq } = request;
	const steps: string[] = [];

	const existing =
		item === 'log_work' ? campaign.logWorkCommodityId : campaign.milestoneHitCommodityId;
	if (existing !== null) {
		return { item, outcome: 'already_provisioned', commodityId: existing, steps };
	}

	const text = itemText(campaign, item);
	const cost = DEPOSIT_AMOUNT[item];
	const startedMs = Date.now();
	const claimed = await claimItemProvisioning(
		db,
		campaignId,
		item,
		timestamp(startedMs),
		timestamp(startedMs + PROVISIONING_LEASE_MS)
	);
	if (!claimed) {
		return {
			item,
			outcome: 'busy',
			commodityId: null,
			steps,
			problem:
				'Another run is working on this item, or an earlier one ended without a clear answer from Qatom. Try again in ten minutes.',
			retry: 'after_wait'
		};
	}

	const progress: ItemProvisioning = claimed;
	const save = async (learned: Partial<ItemProvisioning>) => {
		Object.assign(progress, learned);
		await saveItemProvisioningProgress(db, campaignId, item, learned, timestamp(Date.now()));
	};

	// True only while a create call is in flight: a failure then may have had an effect.
	let creating: 'twin' | 'commodity' | 'catalog item' | null = null;
	try {
		if (progress.twinId === null || progress.twinHostname === null) {
			creating = 'twin';
			const twin = await account.createProviderTwin({ dq });
			creating = null;
			await save({ twinId: twin.twinId, twinHostname: twin.hostname });
			steps.push('created a twin');
		}
		const twinId = progress.twinId;
		const twinHostname = progress.twinHostname;
		if (twinId === null || twinHostname === null) throw new Error('The twin was not saved.');

		if (progress.commodityHash === null) {
			const onTwin = await account.listTwinCommodities(twinHostname);
			const [found, ...others] = onTwin;
			if (others.length > 0) {
				throw new NeedsAPerson(
					`The twin ${twinHostname} sells ${onTwin.length} commodities; it should sell one. A person must look in Qatom.`
				);
			}
			if (found) {
				if (found.cost !== cost || found.dq !== dq) {
					throw new NeedsAPerson(
						`The twin ${twinHostname} already sells a commodity with a different price or digital quantity. A person must look in Qatom.`
					);
				}
				await save({ commodityHash: found.hash });
				steps.push('found the commodity an earlier run created');
			} else {
				creating = 'commodity';
				const created = await account.createCommodity({ twinId, descriptor: text.name, cost, dq });
				creating = null;
				await save({ commodityHash: created.commodityHash });
				steps.push('created the commodity');
			}
		}
		const commodityHash = progress.commodityHash;
		if (commodityHash === null) throw new Error('The commodity was not saved.');

		if (progress.commodityId === null) {
			const described = await account.describeCommodity(commodityHash, text);
			await save({ commodityId: described.commodityId });
			steps.push('set its name and description');
		}
		const commodityId = progress.commodityId;
		if (commodityId === null) throw new Error('The commodity id was not saved.');

		if (progress.catalogItemId === null) {
			const found = await account.findCatalogItem(commodityId);
			if (found) {
				await save({ catalogItemId: found.catalogItemId });
				steps.push('found the catalog item an earlier run created');
			} else {
				creating = 'catalog item';
				const created = await account.createCatalogItem({
					commodityId,
					serviceSchema: itemInputJsonSchema(item),
					externalEndpoint: request.checkinEndpoint,
					secretHeader: { name: CHECKIN_SECRET_HEADER, value: request.checkinSecret }
				});
				creating = null;
				await save({ catalogItemId: created.catalogItemId });
				steps.push('created the catalog item');
			}
		}

		await finishItemProvisioning(db, campaignId, item, commodityId, timestamp(Date.now()));
		steps.push('stored the commodity id on the campaign');
		return { item, outcome: 'provisioned', commodityId, steps };
	} catch (error) {
		if (!(error instanceof QatomError) && !(error instanceof NeedsAPerson)) {
			// Not Qatom's doing (the database, a bug). Leave the lease to run out and say so loudly.
			throw error;
		}
		const unclear = creating !== null && !createdNothing(error);
		if (!unclear) await releaseItemProvisioning(db, campaignId, item, timestamp(Date.now()));

		// A QatomError's message names the call and the status. It never holds a secret or a body.
		let problem = error.message;
		if (unclear) {
			problem +=
				creating === 'twin'
					? ' It is not known whether the twin was created. The next run, in ten minutes or later, makes a new one; the first, if it exists, stays unused.'
					: ` It is not known whether the ${creating} was created. The next run, in ten minutes or later, looks in Qatom before creating anything.`;
		}
		return {
			item,
			outcome: 'failed',
			commodityId: null,
			steps,
			problem,
			retry: unclear ? 'after_wait' : 'now'
		};
	}
}

/** Something in Qatom is not as this code left it. Nothing is created until a person has looked. */
class NeedsAPerson extends Error {}

/** Whether Qatom's document says this answer to a create call means nothing was created. */
function createdNothing(error: Error): boolean {
	if (!(error instanceof QatomHttpError)) return false;
	if (error.status >= 400 && error.status <= 499) return true;
	// POST /v4/catalog/items: 502 "the write was undone", 503 "nothing was created".
	return (
		error.operation === 'account.create-item' && (error.status === 502 || error.status === 503)
	);
}
