// Publishing a draft campaign: the campaign page's own `publish` action and load, and the
// builder's load for the screen after "Create campaign", against a real, migrated, seeded
// database. Nothing here reaches the network.
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, getCampaign, milestones, parties } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load as home } from '../../../+page.server.ts';
import { load as explore } from '../../explore/+page.server.ts';
import { load as give } from '../../needs/+page.server.ts';
import { load as builder } from '../new/+page.server.ts';
import { actions, load } from './+page.server.ts';

const CAMPAIGN = fixtures.campaign.id;
const CREATOR = fixtures.campaign.creatorEmail;
const APP = 'http://localhost:5174';

type Session = { sub: string; email: string } | null;
const creator: Session = { sub: 'qatom-creator', email: CREATOR };
const stranger: Session = { sub: 'qatom-stranger', email: 'someone.else@example.test' };

let test: TestDatabase;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T12:00:00.000Z') });
	test = await createTestDatabase({ seed: true });
	// The seeded campaign, as the builder would have left it: a draft.
	await test.db.update(campaigns).set({ status: 'draft' }).where(eq(campaigns.id, CAMPAIGN));
});
afterEach(async () => {
	vi.useRealTimers();
	await test.destroy();
});

const locals = (session: Session) => ({
	ctx: { db: test.db, config: { OIDC_REDIRECT_URI: `${APP}/auth/callback` } },
	session
});

type Answer = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;

async function publish(session: Session, campaignId: string = CAMPAIGN): Promise<Answer> {
	const event = { params: { campaignId }, locals: locals(session) };
	const answer = await actions.publish(event as unknown as Parameters<typeof actions.publish>[0]);
	return answer as Answer;
}

async function page(session: Session) {
	const event = {
		params: { campaignId: CAMPAIGN },
		locals: locals(session),
		url: new URL(`http://localhost/campaigns/${CAMPAIGN}`)
	};
	const data = await load(event as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('the campaign page loaded nothing');
	return data;
}

async function createdScreen(session: Session, created: string | null) {
	const url = new URL('http://localhost/campaigns/new');
	if (created !== null) url.searchParams.set('created', created);
	const event = { url, locals: locals(session) };
	return builder(event as unknown as Parameters<typeof builder>[0]);
}

/** The ids on the three lists: the home page (/), Explore and Give (/needs). */
async function listed(): Promise<string[][]> {
	const event = { locals: { ctx: { db: test.db } } };
	const lists = [
		await home(event as unknown as Parameters<typeof home>[0]),
		await explore(event as unknown as Parameters<typeof explore>[0]),
		await give(event as unknown as Parameters<typeof give>[0])
	];
	return lists.map((data) => (data?.campaigns ?? []).map((campaign) => campaign.id));
}

const stored = () => getCampaign(test.db, CAMPAIGN);

describe('publishing a draft campaign', () => {
	it('the creator publishes: draft becomes funding, and the campaign is on all three lists', async () => {
		const before = await stored();
		const others = {
			parties: await test.db.select().from(parties),
			milestones: await test.db.select().from(milestones)
		};
		expect(await listed()).toEqual([[], [], []]);

		expect(await publish(creator)).toEqual({ published: true });

		// Only the status changed: nothing else about the campaign, its people or its milestones.
		expect(await stored()).toEqual({ ...before, status: 'funding' });
		expect(await test.db.select().from(parties)).toEqual(others.parties);
		expect(await test.db.select().from(milestones)).toEqual(others.milestones);
		expect(await listed()).toEqual([[CAMPAIGN], [CAMPAIGN], [CAMPAIGN]]);
	});

	it('compares the email without regard to letter case', async () => {
		const shouted = { sub: 'qatom-creator', email: ` ${CREATOR.toUpperCase()} ` };
		expect(CREATOR).not.toBe(CREATOR.toUpperCase());
		expect(await publish(shouted)).toEqual({ published: true });
		expect((await stored())?.status).toBe('funding');
	});

	it('a signed-out visitor cannot publish', async () => {
		const answer = await publish(null);
		expect(answer.status).toBe(401);
		expect(answer.data).toEqual({ published: false, reason: 'signed_out' });
		expect((await stored())?.status).toBe('draft');
		expect(await listed()).toEqual([[], [], []]);
	});

	it('a different signed-in person cannot publish', async () => {
		const answer = await publish(stranger);
		expect(answer.status).toBe(403);
		expect(answer.data).toEqual({ published: false, reason: 'someone_else' });
		expect((await stored())?.status).toBe('draft');
		expect(await listed()).toEqual([[], [], []]);
	});

	it('leaves a campaign that is not a draft alone, whatever its status', async () => {
		for (const status of ['funding', 'funded', 'reporting', 'overdue', 'delivered'] as const) {
			await test.db.update(campaigns).set({ status }).where(eq(campaigns.id, CAMPAIGN));
			const answer = await publish(creator);
			expect(answer.status, status).toBe(409);
			expect(answer.data).toEqual({ published: false, reason: 'not_draft' });
			expect((await stored())?.status).toBe(status);
		}
	});

	it('pressed twice, the second press changes nothing', async () => {
		expect(await publish(creator)).toEqual({ published: true });
		const once = await stored();
		expect((await publish(creator)).status).toBe(409);
		expect(await stored()).toEqual(once);
	});

	it('answers 404 for a campaign that does not exist', async () => {
		expect((await publish(creator, 'no-such-campaign')).status).toBe(404);
	});
});

describe('who is offered the button', () => {
	it('the draft’s own page says who is looking, in one word and without the creator’s email', async () => {
		expect((await page(creator)).publishing).toEqual({ viewer: 'creator' });
		expect((await page(null)).publishing).toEqual({ viewer: 'signed_out' });
		const other = await page(stranger);
		expect(other.publishing).toEqual({ viewer: 'someone_else' });
		expect(JSON.stringify(other)).not.toContain(CREATOR);
	});

	it('a campaign that is not a draft offers nothing', async () => {
		await publish(creator);
		expect((await page(creator)).publishing).toBeNull();
	});

	it('the screen after "Create campaign" learns the same, from the campaign named in its address', async () => {
		expect(await createdScreen(creator, CAMPAIGN)).toEqual({
			publishing: { campaignId: CAMPAIGN, draft: true, viewer: 'creator' }
		});
		expect(await createdScreen(null, CAMPAIGN)).toEqual({
			publishing: { campaignId: CAMPAIGN, draft: true, viewer: 'signed_out' }
		});
		expect(await createdScreen(stranger, CAMPAIGN)).toEqual({
			publishing: { campaignId: CAMPAIGN, draft: true, viewer: 'someone_else' }
		});

		await publish(creator);
		expect(await createdScreen(creator, CAMPAIGN)).toEqual({
			publishing: { campaignId: CAMPAIGN, draft: false, viewer: 'creator' }
		});
	});

	it('knows nothing on the builder’s other screens, or for an address that names no campaign', async () => {
		expect(await createdScreen(creator, null)).toEqual({ publishing: null });
		expect(await createdScreen(creator, '1')).toEqual({ publishing: null });
	});
});
