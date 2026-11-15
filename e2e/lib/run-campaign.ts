/**
 * The campaign a paid run creates for itself, through the campaign API (docs/campaign-api.md),
 * so that every paid run tells the story on milestones nobody has filed on before.
 *
 * It has the same three milestones and the same two people as the fixed test campaign, so every
 * signed-in check applies to it unchanged. The two people are invited at the two test
 * addresses: an invitation is tied to an address, so they sign in from the new campaign's
 * invitations exactly as from the fixed one's.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { E2eConfig } from './config.ts';
import { RUN_CAMPAIGN } from './paths.ts';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/);
const runCampaignSchema = z.object({
	campaignId: id,
	contractorPartyId: id,
	confirmerPartyId: id
});
export type RunCampaign = z.infer<typeof runCampaignSchema>;

/** What the campaign API answers when it has created a campaign. Only what is used here. */
const createdSchema = z.object({
	campaign: z.object({
		id,
		invitations: z.array(z.object({ role: z.string(), url: z.url() }))
	})
});

/** The title says what it is and which run made it, so a person can find and remove it. */
export function runCampaignTitle(runLabel: string | null, now: Date = new Date()): string {
	const which = runLabel ? `run ${runLabel}` : now.toISOString().slice(0, 16).replace('T', ' ');
	return `Automatic test, ${which} (not a real fundraiser)`;
}

/** A date this many days ahead, as the API reads dates. */
function inDays(days: number, now: Date): string {
	return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The request for `POST /api/campaigns`. Pure: the same input gives the same request. */
export function runCampaignRequest(
	cfg: Pick<E2eConfig, 'contractor' | 'confirmer' | 'inbox' | 'runLabel'>,
	now: Date = new Date()
): Record<string, unknown> {
	const due = inDays(365, now);
	const milestone = (key: string, title: string, kind: string) => ({
		key,
		title,
		description: 'An automated test milestone. Nothing is being built or delivered.',
		kind,
		dueDate: due,
		ownerKey: 'contractor',
		confirmerKey: 'confirmer'
	});
	return {
		project: {
			title: runCampaignTitle(cfg.runLabel, now),
			summary:
				'This is not a real project and it is not raising money. Tejido’s automated checks ' +
				'created it, sign in here and file test entries to make sure the site is working. ' +
				'Please do not donate.',
			beneficiary: 'Nobody. This is an automated test.',
			creatorName: 'Tejido automated tests',
			creatorEmail: `e2e-creator@${cfg.inbox.domain}`
		},
		funding: { goal: '' },
		milestones: [
			milestone('m1', 'Test milestone 1: work', 'service'),
			milestone('m2', 'Test milestone 2: a delivery', 'goods_delivery'),
			milestone('m3', 'Test milestone 3: a build', 'construction')
		],
		people: [
			{
				key: 'contractor',
				role: 'third_party',
				name: 'E2E Test Contractor',
				title: 'Test contractor',
				email: cfg.contractor.email,
				relationship: '',
				relationshipReason: ''
			},
			{
				key: 'confirmer',
				role: 'confirmer',
				name: 'E2E Test Confirmer',
				title: 'Test confirmer',
				email: cfg.confirmer.email,
				relationship: 'participant',
				relationshipReason: ''
			}
		],
		schedule: { cadence: 'weekly' }
	};
}

/**
 * Reads the API's answer: the campaign's id, and each person's party id from the end of their
 * invitation link. Throws, naming what is wrong, if the answer is not the documented one.
 */
export function runCampaignFromAnswer(answer: unknown, appUrl: string): RunCampaign {
	const created = createdSchema.parse(answer);
	const partyOf = (role: string): string => {
		const found = created.campaign.invitations.filter((invitation) => invitation.role === role);
		if (found.length !== 1 || !found[0]) {
			throw new Error(`Expected one invitation for a ${role}, and found ${found.length}.`);
		}
		const link = new URL(found[0].url);
		const match = /^\/invite\/([^/]+)$/.exec(link.pathname);
		if (link.origin !== new URL(appUrl).origin || !match?.[1]) {
			throw new Error(`The ${role}’s invitation is not a link to an invite page on the App.`);
		}
		return match[1];
	};
	return runCampaignSchema.parse({
		campaignId: created.campaign.id,
		contractorPartyId: partyOf('third_party'),
		confirmerPartyId: partyOf('confirmer')
	});
}

export function saveRunCampaign(campaign: RunCampaign): void {
	mkdirSync(dirname(RUN_CAMPAIGN), { recursive: true });
	writeFileSync(RUN_CAMPAIGN, JSON.stringify(runCampaignSchema.parse(campaign)));
}

/** The campaign this run created, or null when it created none. */
export function readRunCampaign(): RunCampaign | null {
	if (!existsSync(RUN_CAMPAIGN)) return null;
	return runCampaignSchema.parse(JSON.parse(readFileSync(RUN_CAMPAIGN, 'utf8')));
}

/**
 * The configuration with the run's own campaign in place of the fixed test campaign. Only a
 * paid run has one: an unpaid run always walks the fixed campaign.
 */
export function withRunCampaign(cfg: E2eConfig, campaign: RunCampaign | null): E2eConfig {
	if (!cfg.paid || campaign === null) return cfg;
	return {
		...cfg,
		campaignId: campaign.campaignId,
		contractor: { ...cfg.contractor, partyId: campaign.contractorPartyId },
		confirmer: { ...cfg.confirmer, partyId: campaign.confirmerPartyId }
	};
}
