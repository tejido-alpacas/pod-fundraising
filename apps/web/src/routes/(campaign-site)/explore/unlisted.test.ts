// A campaign the end-to-end tests own is in no public list and no count, and its own pages
// still open. Calls each page's own load against a real, migrated database. `fetch` is replaced,
// here in the test file, by a stub that plays back prepared answers. Nothing reaches the network.
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount, E2E_TEST_EMAIL_DOMAIN } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPubliclyListed } from '#lib/campaign-site/server/campaigns.ts';
import { load as home } from '../../+page.server.ts';
import { load as campaignPage } from '../campaigns/[campaignId]/+page.server.ts';
import { load as givePage } from '../give/[campaignId]/+page.server.ts';
import { load as needs } from '../needs/+page.server.ts';
import { load as explore } from './+page.server.ts';

const API = 'https://pay.stage.m.todaq.net';
const SITE = 'https://tejido.example';
const TEST_OWNER = `creator@${E2E_TEST_EMAIL_DOMAIN}`;

let test: TestDatabase;

const campaign = (
	id: string,
	status: (typeof campaigns.$inferInsert)['status'],
	creatorEmail: string,
	createdAt: string
): typeof campaigns.$inferInsert => ({
	id,
	title: `Title of ${id}`,
	summary: `Summary of ${id}`,
	beneficiary: `the people of ${id}`,
	creatorName: `Creator of ${id}`,
	creatorEmail,
	status,
	cadence: 'weekly',
	logWorkCommodityId: null,
	milestoneHitCommodityId: null,
	createdAt
});

const event = () => ({ locals: { ctx: { db: test.db } } });

/** The ids each public list shows, in the order it shows them. */
async function lists() {
	const [onHome, onExplore, onGive] = await Promise.all([
		home(event() as unknown as Parameters<typeof home>[0]),
		explore(event() as unknown as Parameters<typeof explore>[0]),
		needs(event() as unknown as Parameters<typeof needs>[0])
	]);
	if (!onHome || !onExplore || !onGive) throw new Error('a load returned nothing');
	const ids = (data: { campaigns: { id: string }[] }) => data.campaigns.map((listed) => listed.id);
	return { home: ids(onHome), explore: ids(onExplore), give: ids(onGive) };
}

describe('the rule for public lists', () => {
	it('leaves out drafts and campaigns the tests own, and nothing else', () => {
		const real = 'creator@private.example';
		expect(isPubliclyListed({ status: 'funding', creatorEmail: real })).toBe(true);
		expect(isPubliclyListed({ status: 'reporting', creatorEmail: real })).toBe(true);
		expect(isPubliclyListed({ status: 'draft', creatorEmail: real })).toBe(false);
		for (const status of ['draft', 'funding', 'reporting'] as const) {
			expect(isPubliclyListed({ status, creatorEmail: TEST_OWNER }), status).toBe(false);
		}
	});
});

describe('a campaign the end-to-end tests own', () => {
	afterEach(async () => {
		vi.unstubAllGlobals();
		await test.destroy();
	});

	it('is in no public list and no count while it raises money; a real one still is', async () => {
		test = await createTestDatabase();
		await test.db
			.insert(campaigns)
			.values([
				campaign('real', 'funding', 'creator@private.example', '2026-11-01T00:00:00.000Z'),
				campaign('by-the-tests', 'funding', TEST_OWNER, '2026-11-02T00:00:00.000Z')
			]);

		// Every count a visitor sees is the length of one of these lists.
		expect(await lists()).toEqual({ home: ['real'], explore: ['real'], give: ['real'] });
	});

	it('is in no public list whatever its status, and whatever the case of its address', async () => {
		test = await createTestDatabase();
		await test.db
			.insert(campaigns)
			.values([
				campaign('t-funding', 'funding', TEST_OWNER.toUpperCase(), '2026-11-01T00:00:00.000Z'),
				campaign('t-reporting', 'reporting', TEST_OWNER, '2026-11-02T00:00:00.000Z'),
				campaign('t-draft', 'draft', TEST_OWNER, '2026-11-03T00:00:00.000Z')
			]);

		expect(await lists()).toEqual({ home: [], explore: [], give: [] });
	});

	it('does not hide a real campaign whose address only looks like the test inbox', async () => {
		test = await createTestDatabase();
		await test.db
			.insert(campaigns)
			.values([
				campaign(
					'longer-domain',
					'funding',
					`creator@${E2E_TEST_EMAIL_DOMAIN}.example`,
					'2026-11-01T00:00:00.000Z'
				),
				campaign(
					'subdomain',
					'funding',
					`creator@mail.${E2E_TEST_EMAIL_DOMAIN}`,
					'2026-11-02T00:00:00.000Z'
				),
				campaign(
					'name-part',
					'funding',
					`${E2E_TEST_EMAIL_DOMAIN}@private.example`,
					'2026-11-03T00:00:00.000Z'
				)
			]);

		const all = ['name-part', 'subdomain', 'longer-domain'];
		expect(await lists()).toEqual({ home: all, explore: all, give: all });
	});

	describe('its own pages, for anyone who has the address', () => {
		const CAMPAIGN = fixtures.campaign.id;

		/** The seeded campaign, handed to the tests and raising money. */
		async function seedTestOwned() {
			test = await createTestDatabase({ seed: true });
			await test.db
				.update(campaigns)
				.set({ status: 'funding', creatorEmail: TEST_OWNER })
				.where(eq(campaigns.id, CAMPAIGN));
			expect(await lists()).toEqual({ home: [], explore: [], give: [] });
		}

		it('still opens the campaign page', async () => {
			await seedTestOwned();
			const data = await campaignPage({
				params: { campaignId: CAMPAIGN },
				locals: {
					ctx: { db: test.db, config: { OIDC_REDIRECT_URI: 'http://localhost:5174/auth/callback' } }
				},
				url: new URL(`http://localhost/campaigns/${CAMPAIGN}`)
			} as unknown as Parameters<typeof campaignPage>[0]);
			if (!data) throw new Error('the load returned nothing');

			expect(data.campaign.id).toBe(CAMPAIGN);
			expect(data.campaign.title).toBe(fixtures.campaign.title);
		});

		it('still opens the Give page, open for giving', async () => {
			await seedTestOwned();
			const answers = [
				{ access_token: 'token-1', expires_at: String(Math.floor(Date.now() / 1000) + 3600) },
				{
					items: [
						{
							id: 128,
							active: true,
							commodity_cost: 5,
							external_endpoint: `${SITE}/api/donations/5`
						}
					]
				}
			];
			vi.stubGlobal('fetch', () => {
				const next = answers.shift();
				if (!next) return Promise.reject(new TypeError('fetch failed'));
				return Promise.resolve(new Response(JSON.stringify(next)));
			});
			const account = createMerchantAccount({
				paymentApiUrl: API,
				clientId: 'merchant-account-id',
				clientSecret: 'merchant-account-secret'
			});

			const data = await givePage({
				params: { campaignId: CAMPAIGN },
				locals: {
					ctx: {
						db: test.db,
						config: { WEB_OIDC_REDIRECT_URI: `${SITE}/auth/callback` },
						qatom: { account }
					},
					session: null
				}
			} as unknown as Parameters<typeof givePage>[0]);
			if (!data) throw new Error('the load returned nothing');

			expect(data.campaign.id).toBe(CAMPAIGN);
			expect(data.open).toBe(true);
			expect(data.amounts).toEqual([{ value: 5000, shown: '5.00' }]);
		});
	});
});
