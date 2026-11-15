/**
 * What the campaign builder writes: a new campaign with its parties and milestones, in one
 * batch, and the count that limits how many can be created in an hour.
 *
 * And the one change the builder makes to a campaign that exists: publishing a draft.
 *
 * Nothing here calls Qatom.
 */
import type { Campaign, Milestone, Party } from '@tejido/contracts';
import { and, count, eq, gte } from 'drizzle-orm';
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

/**
 * Publishes a draft: moves the campaign from `draft` to `funding`, the status of a campaign
 * that has just opened, and changes nothing else about it.
 *
 * Only from `draft`. The condition is part of the write, so it is checked against the row as
 * it is at that moment: a campaign in any other status, or one that does not exist, is left
 * alone, and publishing twice changes nothing the second time. Answers whether it moved.
 *
 * Who may publish is not decided here: the caller checks that first.
 */
export async function publishDraftCampaign(db: Executor, campaignId: string): Promise<boolean> {
	const moved = await db
		.update(campaigns)
		.set({ status: 'funding' })
		.where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'draft')))
		.returning({ id: campaigns.id });
	return moved.length > 0;
}
