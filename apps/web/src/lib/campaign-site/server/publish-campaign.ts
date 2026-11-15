/**
 * Publishing a draft campaign: who may, and the one change it makes.
 *
 * The builder asks for no sign-in, and the organiser's email is typed there, not proven. So
 * publishing is where it is proven: only a person signed in on the Campaign Site with Qatom,
 * whose email is the campaign's `creatorEmail`, may publish it. Qatom verified that email when
 * they signed in. The check is made here, on the server, every time; the button's being hidden
 * is a courtesy, not the rule.
 *
 * Publishing moves the campaign from `draft` to `funding` and changes nothing else. Nothing
 * here calls Qatom, moves money or sends email.
 */
import type { Campaign } from '@tejido/contracts';
import { getCampaign, publishDraftCampaign, type Executor } from '@tejido/db';
import type { DonorSession } from './session.ts';

/** Who is looking at a campaign, as far as publishing it goes. */
export type PublishViewer = 'creator' | 'signed_out' | 'someone_else';

const sameEmail = (a: string, b: string): boolean =>
	a.trim().toLowerCase() === b.trim().toLowerCase();

/** Emails are compared without regard to letter case. Nobody signed in is never the creator. */
export function publishViewer(
	session: Pick<DonorSession, 'email'> | null | undefined,
	campaign: Pick<Campaign, 'creatorEmail'>
): PublishViewer {
	if (!session) return 'signed_out';
	return sameEmail(session.email, campaign.creatorEmail) ? 'creator' : 'someone_else';
}

export type PublishRefusal = 'no_campaign' | 'signed_out' | 'someone_else' | 'not_draft';
export type PublishOutcome = { published: true } | { published: false; reason: PublishRefusal };

/**
 * Publishes the campaign if the signed-in person is its creator and it is still a draft.
 * Otherwise nothing is written, and the reason is answered.
 */
export async function publishCampaign(
	db: Executor,
	session: Pick<DonorSession, 'email'> | null | undefined,
	campaignId: string
): Promise<PublishOutcome> {
	const campaign = await getCampaign(db, campaignId);
	if (!campaign) return { published: false, reason: 'no_campaign' };

	const viewer = publishViewer(session, campaign);
	if (viewer !== 'creator') return { published: false, reason: viewer };

	// The write itself only moves a draft, so a second press, or a press in another tab at the
	// same moment, changes nothing.
	const moved = await publishDraftCampaign(db, campaign.id);
	return moved ? { published: true } : { published: false, reason: 'not_draft' };
}
