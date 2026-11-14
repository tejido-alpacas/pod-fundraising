// Calls the endpoint's own handler. The database is real and migrated, and is there to show
// that checking writes nothing to it. Nothing here reaches the network.
import { campaigns, milestones, parties } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES } from '#lib/server/backend/campaign-api.ts';
import { NOW, config, expectNothingPrivate, jsonRequest, validBody } from '../testing.ts';
import { POST } from './+server.ts';

let test: TestDatabase;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
	vi.stubGlobal('fetch', () => {
		throw new Error('A test tried to reach the network.');
	});
	test = await createTestDatabase();
});
afterEach(async () => {
	expect(await test.db.select().from(campaigns)).toEqual([]);
	expect(await test.db.select().from(parties)).toEqual([]);
	expect(await test.db.select().from(milestones)).toEqual([]);
	vi.unstubAllGlobals();
	vi.useRealTimers();
	await test.destroy();
});

type Body = Record<string, unknown>;

async function send(request: Request) {
	const event = { request, url: new URL(request.url), locals: { ctx: { db: test.db, config } } };
	const response = await POST(event as unknown as Parameters<typeof POST>[0]);
	const text = await response.text();
	expectNothingPrivate(response, text);
	return { status: response.status, body: JSON.parse(text) as Body };
}
const check = (body: unknown, step?: string) =>
	send(jsonRequest(`/api/campaigns/check${step === undefined ? '' : `?step=${step}`}`, body));

/** Wrong in every step: project, funding, milestones, people (and who does what), schedule. */
function wrongEverywhere() {
	const bad = validBody();
	bad.project.title = '';
	bad.funding.goal = '-5';
	bad.milestones[0]!.kind = 'party';
	bad.milestones[1]!.ownerKey = 'nobody';
	bad.people[3]!.name = '';
	bad.schedule.cadence = '';
	return bad;
}
const EVERY_PROBLEM = {
	'project.title': 'Give the project a name.',
	'funding.goal': 'Enter the goal as a number, such as 12,000 or 12000.50.',
	'people.c2.name': 'Enter a name.',
	'milestones.m1.kind': 'Choose the kind of milestone.',
	'assign.m2.owner': 'Choose who does the work on this milestone.',
	'schedule.cadence': 'Choose how often work is reported.'
};

describe('POST /api/campaigns/check', () => {
	it('answers 200 and ok for a campaign that would be created, with its notices', async () => {
		const { status, body } = await check(validBody());
		expect(status).toBe(200);
		expect(body).toEqual({
			ok: true,
			fields: {},
			notices: [
				{
					key: 'm2',
					kind: 'no_independent_confirmer',
					title: 'Milestone 2 has no independent confirmer',
					body: 'That’s allowed. Donors will see Joy Baptiste’s confirmation as a stakeholder confirmation.'
				}
			]
		});
	});

	it('answers 200 and every problem by field when there are some', async () => {
		const { status, body } = await check(wrongEverywhere());
		expect(status).toBe(200);
		expect(body['ok']).toBe(false);
		expect(body['fields']).toEqual(EVERY_PROBLEM);
	});

	it('limits the problems to one step when asked, and says whether that step may continue', async () => {
		const expected: Record<string, string[]> = {
			project: ['project.title'],
			funding: ['funding.goal'],
			milestones: ['milestones.m1.kind'],
			// Who does and who confirms each milestone is chosen with the people.
			people: ['people.c2.name', 'assign.m2.owner'],
			schedule: ['schedule.cadence']
		};
		for (const [step, names] of Object.entries(expected)) {
			const { status, body } = await check(wrongEverywhere(), step);
			expect(status, step).toBe(200);
			expect(body['ok'], step).toBe(false);
			expect(Object.keys(body['fields'] as object), step).toEqual(names);
		}

		// A step with nothing wrong may continue, whatever is wrong elsewhere.
		const later = validBody();
		later.schedule.cadence = '';
		expect((await check(later, 'project')).body).toMatchObject({ ok: true, fields: {} });
		expect((await check(later)).body).toMatchObject({ ok: false });
	});

	it('refuses a step it does not know', async () => {
		for (const step of ['review', 'budget', '']) {
			const { status, body } = await check(validBody(), step);
			expect(status, step).toBe(400);
			expect(body['error'], step).toBe('invalid_step');
		}
	});

	it('refuses a body that is not a JSON object, is too large, or is not sent as JSON', async () => {
		for (const sent of ['not json', 'null', '[]', '"text"']) {
			const { status, body } = await check(sent);
			expect(status, sent).toBe(400);
			expect(body['error'], sent).toBe('invalid_body');
		}

		const large = await check(`{"padding":"${'x'.repeat(MAX_BODY_BYTES)}"}`);
		expect(large.status).toBe(400);
		expect(large.body['error']).toBe('invalid_body');

		const plain = await send(
			jsonRequest('/api/campaigns/check', validBody(), { 'content-type': 'text/plain' })
		);
		expect(plain.status).toBe(415);
		expect(plain.body['error']).toBe('unsupported_media_type');
	});
});
