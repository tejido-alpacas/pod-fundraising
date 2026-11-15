// Runs item provisioning through its route against a real, migrated, seeded database, with the
// real merchant account client. Nothing here reaches the network and nothing is created in
// Qatom: `fetch` is replaced, in this file only, by a stub that answers the calls Qatom's API
// document describes (token, twin, commodity, catalog item) from a small in-test state.
import { CHECKIN_SECRET_HEADER, itemInputJsonSchema } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, getCampaign, itemProvisioning } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createMerchantAccount } from '@tejido/qatom/account';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	itemText,
	MAX_DESCRIPTION_LENGTH,
	type ItemReport
} from '#lib/server/backend/provisioning.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const API = 'https://pay.stage.m.todaq.net';
const SITE = 'https://tejido.net';
const DQ = '41dq';
const TWIN_KEY = '00000000-0000-4000-8000-000000000000';
const CAMPAIGN = fixtures.campaign.id;

interface Recorded {
	method: string;
	path: string;
	authorization: string | undefined;
	body: unknown;
}
/** What the stub answers instead of doing the work: a status, or no answer at all. */
type Fault = { status: number; after?: 'doing it' } | { timeout: true; after?: 'doing it' };

/** The stand-in for Qatom's state, as far as these calls show it. */
let qatom: {
	twins: { id: number; hostname: string }[];
	commodities: {
		id: number;
		hash: string;
		twinId: number;
		cost: number;
		dq: string;
		name?: string;
	}[];
	items: { id: number; commodity_id: number }[];
};
let requests: Recorded[];
/** Keyed by "METHOD /path-prefix". Used once, then removed. */
let faults: Record<string, Fault>;
let test: TestDatabase;

const writes = () => requests.filter((request) => request.method !== 'GET').slice(1);
const count = (method: string, path: string) =>
	requests.filter((request) => request.method === method && request.path.startsWith(path)).length;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	// A campaign whose items do not exist yet.
	await test.db
		.update(campaigns)
		.set({ logWorkCommodityId: null, milestoneHitCommodityId: null })
		.where(eq(campaigns.id, CAMPAIGN));
	qatom = { twins: [], commodities: [], items: [] };
	requests = [];
	faults = {};

	vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? 'GET';
		const path = url.pathname;
		const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
		requests.push({
			method,
			path: path + url.search,
			authorization: (init.headers as Record<string, string>).authorization,
			body
		});
		const answer = (json: unknown, status = 200) =>
			Promise.resolve(new Response(JSON.stringify(json), { status }));
		if (url.origin !== API) return Promise.reject(new Error(`unexpected request: ${url.href}`));

		if (path === '/v4/account/oauth/token') {
			return answer({
				access_token: 'account-token',
				// A string of digits, as Qatom's server sends it.
				expires_at: String(Math.floor(Date.now() / 1000) + 3600)
			});
		}

		const key = Object.keys(faults).find((fault) => `${method} ${path}`.startsWith(fault));
		const fault = key === undefined ? undefined : faults[key];
		if (key !== undefined) delete faults[key];
		const fail = () =>
			fault && 'status' in fault
				? answer({ error: 'Something went wrong', status: fault.status }, fault.status)
				: Promise.reject(new DOMException('timed out', 'TimeoutError'));
		if (fault && fault.after !== 'doing it') return fail();
		const fields = (body ?? {}) as Record<string, unknown>;

		if (method === 'POST' && path === '/v4/twin') {
			const id = 3601 + qatom.twins.length;
			const twin = { id, hostname: `twin${id}.micro.biz.todaq.net` };
			qatom.twins.push(twin);
			return fault ? fail() : answer({ ...twin, key: TWIN_KEY, balances: { [DQ]: 0 } }, 201);
		}
		const twinHostname = /^\/v4\/twin\/([^/]+)\/commodities$/.exec(path)?.[1];
		if (method === 'GET' && twinHostname !== undefined) {
			const twin = qatom.twins.find((candidate) => candidate.hostname === twinHostname);
			if (!twin) return answer({ error: 'Not Found', status: 404 }, 404);
			return answer(
				qatom.commodities
					.filter((commodity) => commodity.twinId === twin.id)
					.map(({ hash, cost, dq }) => ({ hash, cost, dq, hostname: twin.hostname }))
			);
		}
		if (method === 'POST' && path === '/v4/commodity') {
			const id = 118 + qatom.commodities.length;
			const commodity = {
				id,
				// A UUID with hyphens, as Qatom's server gives a commodity hash.
				hash: `3f2b8c1e-5d47-4a9b-8e21-000000000${id}`,
				twinId: fields.twin_id as number,
				cost: fields.cost as number,
				dq: fields.dq as string
			};
			qatom.commodities.push(commodity);
			return fault
				? fail()
				: answer({ hash: commodity.hash, descriptor: fields.descriptor, dq: DQ }, 201);
		}
		const commodityHash = /^\/v4\/commodity\/([\w-]+)$/.exec(path)?.[1];
		if (method === 'PUT' && commodityHash !== undefined) {
			const commodity = qatom.commodities.find((candidate) => candidate.hash === commodityHash);
			if (!commodity) return answer({ error: 'Not Found', status: 404 }, 404);
			commodity.name = fields.name as string;
			return answer({
				commodity: { id: commodity.id, hash: commodity.hash, name: commodity.name }
			});
		}
		if (method === 'GET' && path === '/v4/catalog/items') {
			const commodityId = Number(url.searchParams.get('commodity_id'));
			const items = qatom.items.filter((item) => item.commodity_id === commodityId);
			return answer({ items, total: items.length, limit: null, offset: 0 });
		}
		if (method === 'POST' && path === '/v4/catalog/items') {
			const item = { id: 42 + qatom.items.length, commodity_id: fields.commodity_id as number };
			qatom.items.push(item);
			return fault
				? fail()
				: answer(
						{
							item: { ...item, service_method: 'POST', active: true, featured: true },
							dispatch_params: [
								{
									id: 7,
									kind: 'header',
									name: CHECKIN_SECRET_HEADER,
									sensitive: true,
									value: null,
									value_set: true,
									updated_at: '2026-11-14T12:00:00.000Z'
								}
							]
						},
						201
					);
		}
		return Promise.reject(new Error(`unexpected request: ${method} ${url.href}`));
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await test.destroy();
});

interface Answer {
	provisioned: boolean;
	error?: string;
	message?: string;
	items?: ItemReport[];
}

async function run(
	options: {
		headers?: Record<string, string>;
		body?: unknown;
		origin?: string;
	} = {}
) {
	const address = `${options.origin ?? SITE}/api/provisioning`;
	const request = new Request(address, {
		method: 'POST',
		headers: options.headers ?? { [CHECKIN_SECRET_HEADER]: SECRET },
		body: JSON.stringify(options.body ?? { campaign_id: CAMPAIGN, dq: DQ })
	});
	const account = createMerchantAccount({
		paymentApiUrl: API,
		clientId: 'merchant-account-id',
		clientSecret: 'merchant-account-secret'
	});
	const locals = {
		ctx: { db: test.db, config: { CHECKIN_SHARED_SECRET: SECRET }, qatom: { account } }
	};
	const response = await POST({ request, url: new URL(address), locals } as unknown as Parameters<
		typeof POST
	>[0]);
	return { status: response.status, body: (await response.json()) as Answer };
}

const campaign = async () => (await getCampaign(test.db, CAMPAIGN))!;
const progress = () => test.db.select().from(itemProvisioning);
/** Lets a lease run out without waiting ten minutes. */
const expireLeases = () =>
	test.db.update(itemProvisioning).set({ lockedUntil: '2000-01-01T00:00:00.000Z' });

describe('POST /api/provisioning', () => {
	it('refuses a caller without the shared secret, and sends nothing to Qatom', async () => {
		expect((await run({ headers: {} })).status).toBe(401);
		expect((await run({ headers: { [CHECKIN_SECRET_HEADER]: 'wrong' } })).status).toBe(401);

		expect(requests).toEqual([]);
		expect(await campaign()).toMatchObject({
			logWorkCommodityId: null,
			milestoneHitCommodityId: null
		});
		expect(await progress()).toEqual([]);
	});

	it('refuses a body that does not name a campaign and a digital quantity', async () => {
		expect((await run({ body: { campaign_id: CAMPAIGN } })).status).toBe(422);
		expect((await run({ body: { dq: DQ } })).status).toBe(422);
		expect((await run({ body: { campaign_id: CAMPAIGN, dq: 'not a hash!' } })).status).toBe(422);
		expect(requests).toEqual([]);
	});

	it('refuses an unknown campaign, one not yet funded, and a site that is not https', async () => {
		expect((await run({ body: { campaign_id: 'no-such-campaign', dq: DQ } })).status).toBe(404);

		expect((await run({ origin: 'http://localhost:5173' })).body).toMatchObject({
			provisioned: false,
			error: 'endpoint_not_https'
		});

		await test.db.update(campaigns).set({ status: 'funding' }).where(eq(campaigns.id, CAMPAIGN));
		const funding = await run();
		expect(funding.status).toBe(409);
		expect(funding.body.error).toBe('not_funded');

		expect(requests).toEqual([]);
	});

	it('creates both items for a fresh campaign and stores their commodity ids', async () => {
		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toEqual({
			provisioned: true,
			campaign_id: CAMPAIGN,
			items: [
				{
					item: 'log_work',
					outcome: 'provisioned',
					commodityId: 118,
					steps: [
						'created a twin',
						'created the commodity',
						'set its name and description',
						'created the catalog item',
						'stored the commodity id on the campaign'
					]
				},
				{
					item: 'milestone_hit',
					outcome: 'provisioned',
					commodityId: 119,
					steps: expect.any(Array)
				}
			]
		});
		expect(await campaign()).toMatchObject({
			logWorkCommodityId: 118,
			milestoneHitCommodityId: 119
		});
		// Each item is on a twin of its own.
		expect(qatom.commodities.map((commodity) => commodity.twinId)).toEqual([3601, 3602]);
		expect(qatom.items).toHaveLength(2);
	});

	it('sends the requests Qatom documents, with the merchant account token only', async () => {
		await run();

		const logWork = itemText(fixtures.campaign, 'log_work');
		const milestoneHit = itemText(fixtures.campaign, 'milestone_hit');
		const item = (commodityId: number, kind: 'log_work' | 'milestone_hit') => ({
			method: 'POST',
			path: '/v4/catalog/items',
			body: {
				commodity_id: commodityId,
				service_method: 'POST',
				service_schema: itemInputJsonSchema(kind),
				external_endpoint: 'https://tejido.net/api/checkins',
				active: true,
				featured: true,
				dispatch_params: [
					{ kind: 'header', name: 'X-Tejido-Checkin-Secret', sensitive: true, value: SECRET }
				]
			}
		});
		expect(requests.map(({ authorization: _token, ...request }) => request)).toEqual([
			{ method: 'POST', path: '/v4/account/oauth/token', body: undefined },
			// Log work, 0.10.
			{ method: 'POST', path: '/v4/twin', body: { dq: DQ, type: 'provider' } },
			{ method: 'GET', path: '/v4/twin/twin3601.micro.biz.todaq.net/commodities', body: undefined },
			{
				method: 'POST',
				path: '/v4/commodity',
				// Our 100 thousandths go to Qatom as 0.1 USD-TDN, and our 1000 as 1.
				body: { descriptor: 'Rebuild the library wing log work', cost: 0.1, dq: DQ, twin_id: 3601 }
			},
			{ method: 'PUT', path: '/v4/commodity/3f2b8c1e-5d47-4a9b-8e21-000000000118', body: logWork },
			{
				method: 'GET',
				path: '/v4/catalog/items?commodity_id=118&mine=true&active=all',
				body: undefined
			},
			item(118, 'log_work'),
			// Milestone hit, 1.00.
			{ method: 'POST', path: '/v4/twin', body: { dq: DQ, type: 'provider' } },
			{ method: 'GET', path: '/v4/twin/twin3602.micro.biz.todaq.net/commodities', body: undefined },
			{
				method: 'POST',
				path: '/v4/commodity',
				body: {
					descriptor: 'Rebuild the library wing milestone hit',
					cost: 1,
					dq: DQ,
					twin_id: 3602
				}
			},
			{
				method: 'PUT',
				path: '/v4/commodity/3f2b8c1e-5d47-4a9b-8e21-000000000119',
				body: milestoneHit
			},
			{
				method: 'GET',
				path: '/v4/catalog/items?commodity_id=119&mine=true&active=all',
				body: undefined
			},
			item(119, 'milestone_hit')
		]);
		expect(requests[0]!.authorization).toMatch(/^Basic /);
		for (const request of requests.slice(1)) {
			expect(request.authorization).toBe('Bearer account-token');
		}
		for (const text of [logWork, milestoneHit]) {
			expect(text.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
		}
	});

	it('keeps no secret: not the check-in secret, not the twin key', async () => {
		const { body } = await run();

		const kept = JSON.stringify([await progress(), await campaign(), body]);
		expect(kept).not.toContain(SECRET);
		expect(kept).not.toContain(TWIN_KEY);
		expect(await progress()).toEqual([
			{
				campaignId: CAMPAIGN,
				item: 'log_work',
				twinId: 3601,
				twinHostname: 'twin3601.micro.biz.todaq.net',
				commodityHash: '3f2b8c1e-5d47-4a9b-8e21-000000000118',
				commodityId: 118,
				catalogItemId: 42,
				lockedUntil: null,
				updatedAt: expect.any(String)
			},
			expect.objectContaining({ item: 'milestone_hit', catalogItemId: 43, lockedUntil: null })
		]);
	});

	it('leaves an already provisioned campaign alone: nothing is sent to Qatom', async () => {
		await test.db
			.update(campaigns)
			.set({ logWorkCommodityId: 3152, milestoneHitCommodityId: 3153 })
			.where(eq(campaigns.id, CAMPAIGN));

		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body.provisioned).toBe(true);
		expect(body.items!.map((item) => [item.outcome, item.commodityId])).toEqual([
			['already_provisioned', 3152],
			['already_provisioned', 3153]
		]);
		expect(requests).toEqual([]);
	});

	it('changes nothing on a second run', async () => {
		await run();
		const sent = requests.length;

		const second = await run();

		expect(second.body.items!.map((item) => item.outcome)).toEqual([
			'already_provisioned',
			'already_provisioned'
		]);
		expect(requests).toHaveLength(sent);
		expect(qatom.twins).toHaveLength(2);
	});

	it('finishes a campaign that has one item: only the missing one is created', async () => {
		await test.db
			.update(campaigns)
			.set({ logWorkCommodityId: 3152 })
			.where(eq(campaigns.id, CAMPAIGN));

		const { body } = await run();

		expect(body.items!.map((item) => item.outcome)).toEqual(['already_provisioned', 'provisioned']);
		expect(await campaign()).toMatchObject({
			logWorkCommodityId: 3152,
			milestoneHitCommodityId: 118
		});
		expect(qatom.twins).toHaveLength(1);
		expect(qatom.items).toHaveLength(1);
		expect(writes().find((request) => request.path === '/v4/commodity')!.body).toMatchObject({
			descriptor: 'Rebuild the library wing milestone hit',
			cost: 1
		});
	});

	it('when Qatom refuses a step, stores no id, and the next run continues without duplicates', async () => {
		// Qatom's document: 502 means the twin refused the paywall and the write was undone.
		faults['POST /v4/catalog/items'] = { status: 502 };

		const first = await run();

		expect(first.status).toBe(502);
		expect(first.body.provisioned).toBe(false);
		expect(first.body.items).toEqual([
			{
				item: 'log_work',
				outcome: 'failed',
				commodityId: null,
				steps: ['created a twin', 'created the commodity', 'set its name and description'],
				problem: 'Qatom account.create-item failed with 502: Something went wrong',
				retry: 'now'
			},
			{ item: 'milestone_hit', outcome: 'not_attempted', commodityId: null, steps: [] }
		]);
		expect(await campaign()).toMatchObject({
			logWorkCommodityId: null,
			milestoneHitCommodityId: null
		});
		expect(await progress()).toEqual([
			expect.objectContaining({ commodityId: 118, catalogItemId: null, lockedUntil: null })
		]);

		const second = await run();

		expect(second.body.provisioned).toBe(true);
		expect(second.body.items![0]).toMatchObject({
			outcome: 'provisioned',
			steps: ['created the catalog item', 'stored the commodity id on the campaign']
		});
		expect(await campaign()).toMatchObject({
			logWorkCommodityId: 118,
			milestoneHitCommodityId: 119
		});
		// One twin and one commodity per item, across both runs.
		expect(count('POST', '/v4/twin')).toBe(2);
		expect(count('POST', '/v4/commodity')).toBe(2);
		expect(qatom.items).toHaveLength(2);
	});

	it('after a create call with no answer, waits, then adopts what Qatom made instead of creating it again', async () => {
		// The commodity is created, but the answer never arrives.
		faults['POST /v4/commodity'] = { timeout: true, after: 'doing it' };

		const first = await run();

		expect(first.body.items![0]).toMatchObject({
			outcome: 'failed',
			retry: 'after_wait',
			steps: ['created a twin']
		});
		expect(first.body.items![0]!.problem).toContain('not known whether the commodity was created');
		expect(await campaign()).toMatchObject({ logWorkCommodityId: null });

		// At once: the lease is still held, so nothing at all is sent to Qatom.
		const sent = requests.length;
		const tooSoon = await run();
		expect(tooSoon.status).toBe(502);
		expect(tooSoon.body.items!.map((item) => item.outcome)).toEqual(['busy', 'not_attempted']);
		expect(requests).toHaveLength(sent);

		await expireLeases();
		const later = await run();

		expect(later.body.provisioned).toBe(true);
		expect(later.body.items![0]!.steps[0]).toBe('found the commodity an earlier run created');
		// Log work's commodity was created once; the other POST is milestone hit's.
		expect(qatom.commodities).toHaveLength(2);
		expect(count('POST', '/v4/twin')).toBe(2);
		expect(await campaign()).toMatchObject({
			logWorkCommodityId: 118,
			milestoneHitCommodityId: 119
		});
	});

	it('adopts a catalog item whose creation was never answered', async () => {
		faults['POST /v4/catalog/items'] = { status: 500, after: 'doing it' };

		const first = await run();
		expect(first.body.items![0]).toMatchObject({ outcome: 'failed', retry: 'after_wait' });
		expect(await campaign()).toMatchObject({ logWorkCommodityId: null });

		await expireLeases();
		const later = await run();

		expect(later.body.items![0]!.steps).toEqual([
			'found the catalog item an earlier run created',
			'stored the commodity id on the campaign'
		]);
		expect(qatom.items).toHaveLength(2);
		expect(count('POST', '/v4/catalog/items')).toBe(2);
	});

	it('stops for a person when a twin sells something this code did not leave there', async () => {
		faults['POST /v4/commodity'] = { timeout: true, after: 'doing it' };
		await run();
		qatom.commodities[0]!.cost = 5;
		await expireLeases();

		const { body } = await run();

		expect(body.items![0]).toMatchObject({ outcome: 'failed', retry: 'now' });
		expect(body.items![0]!.problem).toContain('A person must look in Qatom');
		expect(count('POST', '/v4/commodity')).toBe(1);
		expect(await campaign()).toMatchObject({ logWorkCommodityId: null });
	});
});
