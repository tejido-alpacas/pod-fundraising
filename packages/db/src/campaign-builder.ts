/**
 * What the campaign builder writes: a new campaign with its parties and milestones, in one
 * batch, and the count that limits how many can be created in an hour.
 *
 * Nothing here calls Qatom, and nothing here reads or changes an existing campaign.
 */
import type { Campaign, Milestone, Party } from '@tejido/contracts';
import { count, gte } from 'drizzle-orm';
import type { Database, Executor } from './client.ts';
import { campaigns, milestones, parties } from './schema.ts';

export interface NewCampaign {
	campaign: Campaign;
	parties: Party[];
	milestones: Milestone[];
}

/**
 * Inserts a campaign, then its parties, then its milestones, as one batch: D1 runs a batch as
 * a single transaction, so either every row is written or none is. Parties go before
 * milestones because a milestone names the party who owes it and the party who confirms it.
 */
export async function insertCampaignWithPartiesAndMilestones(
	db: Database,
	created: NewCampaign
): Promise<void> {
	const insertCampaign = db.insert(campaigns).values(created.campaign);
	const rest = [
		...(created.parties.length > 0 ? [db.insert(parties).values(created.parties)] : []),
		...(created.milestones.length > 0 ? [db.insert(milestones).values(created.milestones)] : [])
	];
	await db.batch([insertCampaign, ...rest]);
}

/** How many campaigns, of any status, were created at or after `since` (an ISO 8601 time). */
export async function countCampaignsCreatedSince(db: Executor, since: string): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(campaigns)
		.where(gte(campaigns.createdAt, since));
	return row?.total ?? 0;
}
