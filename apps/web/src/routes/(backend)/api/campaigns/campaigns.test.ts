// Calls the endpoint's own handler against a real, migrated local D1 database. Nothing here
// reaches the network: the endpoint calls nothing outside the database.
import { campaignSchema, milestoneSchema, partySchema } from '@tejido/contracts';
import { campaigns, milestones, parties } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATED_PER_HOUR } from '#lib/campaign-site/server/create-campaign.ts';
import { MAX_BODY_BYTES } from '#lib/server/backend/campaign-api.ts';
import { POST } from './+server.ts';
import { NOW, config, expectNothingPrivate, jsonRequest, validBody } from './testing.ts';

let test: TestDatabase;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
	vi.stubGlobal('fetch', () => {
		throw new Error('A test tried to reach the network.');
	});
	test = await createTestDatabase();
});
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	await test.destroy();
});

type Body = Record<string, unknown>;

async function send(request: Request) {
	const locals = { ctx: { db: test.db, config } };
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	const text = await response.text();
	expectNothingPrivate(response, text);
	return { response, status: response.status, body: JSON.parse(text) as Body };
}
const create = (body: unknown) => send(jsonRequest('/api/campaigns', body));

async function saved() {
	return {
		campaigns: await test.db.select().from(campaigns),
		parties: await test.db.select().from(parties),
		milestones: await test.db.select().from(milestones)
	};
}
async function expectNothingSaved() {
	expect(await saved()).toEqual({ campaigns: [], parties: [], milestones: [] });
}

describe('POST /api/campaigns', () => {
	it('creates one draft campaign with its people and milestones, and answers 201', async () => {
		const { response, status, body } = await create(validBody());
		expect(status).toBe(201);

		const rows = await saved();
		expect(rows.campaigns).toHaveLength(1);
		const campaign = campaignSchema.parse(rows.campaigns[0]);
		expect(campaign).toMatchObject({
			title: 'Repair the clinic roof',
			status: 'draft',
			cadence: 'weekly',
			fundingGoal: 8_500_500,
			creatorEmail: 'committee@palmpoint.example',
			logWorkCommodityId: null,
			milestoneHitCommodityId: null,
			donationCommodityId: null,
			createdAt: NOW
		});
		// The id is the draft's only address, so it ends in 20 random characters.
		expect(campaign.id).toMatch(/^repair-the-clinic-roof-[0-9a-f]{20}$/);

		const people = rows.parties.map((row) => partySchema.parse(row));
		expect(people.map((person) => [person.role, person.name, person.relationship])).toEqual([
			['third_party', 'Tradewind Roofing', 'participant'],
			['third_party', 'Island Pharmacy Supply', 'participant'],
			['confirmer', 'Marlon Reid', 'independent'],
			['confirmer', 'Joy Baptiste', 'stakeholder']
		]);
		expect(people.every((person) => person.campaignId === campaign.id)).toBe(true);
		expect(people.every((person) => person.agentWalletHostname === null)).toBe(true);
		expect(people.every((person) => person.primaryWalletHostname === null)).toBe(true);

		const steps = rows.milestones.map((row) => milestoneSchema.parse(row));
		expect(steps.map((step) => [step.position, step.id, step.state, step.dueDate])).toEqual([
			[1, 'm1-roof-replaced', 'open', '2026-12-18'],
			[2, 'm2-medicines-restocked', 'open', '2027-01-15']
		]);
		expect(steps[0]).toMatchObject({
			ownerPartyId: people[0]!.id,
			confirmerPartyId: people[2]!.id
		});
		expect(steps[1]).toMatchObject({
			ownerPartyId: people[1]!.id,
			confirmerPartyId: people[3]!.id
		});

		// The answer: exactly this shape, and the campaign's path as the Location.
		expect(body).toEqual({
			campaign: {
				id: campaign.id,
				title: 'Repair the clinic roof',
				path: `/campaigns/${campaign.id}`,
				invitations: people.map((person) => ({
					name: person.name,
					title: person.title,
					role: person.role,
					url: `https://app.tejido.example/invite/${person.id}`
				}))
			},
			notices: [
				{
					key: 'm2',
					kind: 'no_independent_confirmer',
					title: 'Milestone 2 has no independent confirmer',
					body: 'That’s allowed. Donors will see Joy Baptiste’s confirmation as a stakeholder confirmation.'
				}
			]
		});
		expect(response.headers.get('location')).toBe(`/campaigns/${campaign.id}`);
		expect(response.headers.get('content-type')).toContain('application/json');
	});

	it('gives two campaigns with the same title different, unguessable ids', async () => {
		const first = (await create(validBody())).body['campaign'] as { id: string };
		const second = (await create(validBody())).body['campaign'] as { id: string };
		expect(first.id).not.toBe(second.id);
		expect((await saved()).campaigns).toHaveLength(2);
	});

	it('answers 400 invalid_campaign with the problems by field, and saves nothing', async () => {
		const bad = validBody();
		bad.project.title = ' ';
		bad.funding.goal = 'lots';
		bad.milestones[0]!.dueDate = '2026-02-30';
		bad.milestones[1]!.confirmerKey = 'p2';
		bad.people[2]!.email = 'not an address';
		bad.schedule.cadence = 'monthly';

		const { response, status, body } = await create(bad);
		expect(status).toBe(400);
		expect(response.headers.get('location')).toBeNull();
		expect(body).toEqual({
			error: 'invalid_campaign',
			message: 'Some answers are missing or need changing. Nothing was saved.',
			fields: {
				'project.title': 'Give the project a name.',
				'funding.goal': 'Enter the goal as a number, such as 12,000 or 12000.50.',
				'people.c1.email': 'Enter an email address, such as name@example.org.',
				'milestones.m1.dueDate': 'Choose the date this is due.',
				'assign.m2.confirmer':
					'Island Pharmacy Supply does the work on this milestone, so someone else has to confirm it.',
				'schedule.cadence': 'Choose how often work is reported.'
			},
			notices: []
		});
		await expectNothingSaved();
	});

	it('treats an empty object as a campaign with everything missing', async () => {
		const { status, body } = await create({});
		expect(status).toBe(400);
		expect(body['error']).toBe('invalid_campaign');
		expect(Object.keys(body['fields'] as object).sort()).toEqual([
			'milestones._',
			'people.confirmer',
			'people.third_party',
			'project.creatorEmail',
			'project.creatorName',
			'project.title',
			'schedule.cadence'
		]);
		await expectNothingSaved();
	});

	it('never echoes what was sent, so no address can come back in a refusal', async () => {
		const bad = validBody();
		// The same address as the contractor: the refusal names the contractor, not the address.
		bad.people[2]!.email = 'JOBS@tradewind.example';
		const { status, body } = await create(bad);
		expect(status).toBe(400);
		expect(Object.keys(body['fields'] as object)).toEqual([
			'people.c1.relationship',
			'assign.m1.confirmer'
		]);
		expect(JSON.stringify(body).toLowerCase()).not.toContain('tradewind.example');
	});

	it('answers 400 invalid_body when the body is not a JSON object', async () => {
		for (const sent of [
			'',
			'not json',
			'{"project":',
			'null',
			'"a campaign"',
			'12',
			'[]',
			'[{}]'
		]) {
			const { status, body } = await create(sent);
			expect(status, sent).toBe(400);
			expect(body['error'], sent).toBe('invalid_body');
			expect(typeof body['message']).toBe('string');
			expect(body['fields']).toBeUndefined();
		}
		await expectNothingSaved();
	});

	it('answers 400 invalid_body when the body is too large, whatever its length header says', async () => {
		const large = validBody();
		large.project.summary = 'x'.repeat(MAX_BODY_BYTES);
		const text = JSON.stringify(large);

		// As sent by an honest client: the length is declared, and nothing is read.
		const declared = await send(
			jsonRequest('/api/campaigns', text, {
				'content-type': 'application/json',
				'content-length': String(text.length)
			})
		);
		expect(declared.status).toBe(400);
		expect(declared.body['error']).toBe('invalid_body');

		// With no declared length, sent in pieces: reading stops at the limit.
		let sent = 0;
		const piece = new TextEncoder().encode(text.slice(0, 50_000));
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				sent += 1;
				controller.enqueue(piece);
			}
		});
		const streamed = await send(
			new Request('http://localhost/api/campaigns', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: stream,
				duplex: 'half'
			} as RequestInit)
		);
		expect(streamed.status).toBe(400);
		expect(streamed.body['error']).toBe('invalid_body');
		expect(sent).toBeLessThan(10);

		// Exactly at the limit is read: this one is refused for what it says, not its size.
		const padded = `{"padding":"${'x'.repeat(MAX_BODY_BYTES - 14)}"}`;
		expect(padded).toHaveLength(MAX_BODY_BYTES);
		expect((await create(padded)).body['error']).toBe('invalid_campaign');
		expect((await create(`${padded} `)).body['error']).toBe('invalid_body');
		await expectNothingSaved();
	});

	it('answers 415 unless the content type is application/json', async () => {
		const text = JSON.stringify(validBody());
		// A browser sends these three from another site's page without asking first.
		for (const type of [
			'text/plain',
			'application/x-www-form-urlencoded',
			'multipart/form-data; boundary=x',
			'application/jsonp',
			''
		]) {
			const headers: Record<string, string> = type === '' ? {} : { 'content-type': type };
			const request = new Request('http://localhost/api/campaigns', {
				method: 'POST',
				headers,
				body: new TextEncoder().encode(text)
			});
			const { status, body } = await send(request);
			expect(status, type).toBe(415);
			expect(body['error'], type).toBe('unsupported_media_type');
		}
		await expectNothingSaved();

		const { status } = await send(
			jsonRequest('/api/campaigns', text, { 'content-type': 'Application/JSON; charset=utf-8' })
		);
		expect(status).toBe(201);
	});

	it('answers 429 too_many once the hour’s limit is reached, and saves nothing more', async () => {
		for (let made = 0; made < CREATED_PER_HOUR; made += 1) {
			expect((await create(validBody())).status).toBe(201);
		}
		const { status, body } = await create(validBody());
		expect(status).toBe(429);
		expect(body).toEqual({
			error: 'too_many',
			message: `Tejido creates at most ${String(CREATED_PER_HOUR)} campaigns an hour, and that many have just been created. Nothing was saved. Try again in an hour.`
		});
		expect((await saved()).campaigns).toHaveLength(CREATED_PER_HOUR);

		// An invalid campaign is still told what is wrong, not that the limit is reached.
		expect((await create({})).status).toBe(400);

		// An hour later there is room again.
		vi.setSystemTime(new Date(new Date(NOW).getTime() + 60 * 60 * 1000 + 1));
		expect((await create(validBody())).status).toBe(201);
	});
});
