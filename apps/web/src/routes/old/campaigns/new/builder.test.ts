// Calls the campaign builder's own actions against a real, migrated database. Nothing here
// reaches the network.
import { campaignSchema, milestoneSchema, partySchema } from '@tejido/contracts';
import { campaigns, milestones, parties } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkDraft, noticesFor, readGoal } from '#lib/old/builder/check.ts';
import { reviveDraft, type BuilderDraft } from '#lib/old/builder/draft.ts';
import { CREATED_PER_HOUR } from '#lib/old/server/create.ts';
import { load as home } from '../../+page.server.ts';
import { actions } from './+page.server.ts';

let test: TestDatabase;

const NOW = '2026-11-14T12:00:00.000Z';
// The App is where the sign-in callback is, so its origin is where invitations open.
const config = { OIDC_REDIRECT_URI: 'https://app.tejido.example/auth/callback' };

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
	test = await createTestDatabase();
});
afterEach(async () => {
	vi.useRealTimers();
	await test.destroy();
});

/** A draft that passes every check: two milestones, two who do the work, two who confirm. */
function validDraft(): BuilderDraft {
	return {
		project: {
			title: '  Repair the clinic roof ',
			summary: 'The storm lifted half the roof off Palm Point clinic.',
			beneficiary: 'The families of Palm Point',
			creatorName: 'Palm Point Health Committee',
			creatorEmail: ' Committee@PalmPoint.example '
		},
		funding: { goal: '8,500.50' },
		milestones: [
			{
				key: 'm1',
				title: 'Roof replaced',
				description: 'New sheeting on the whole roof.',
				kind: 'construction',
				dueDate: '2026-12-18',
				ownerKey: 'p1',
				confirmerKey: 'c1'
			},
			{
				key: 'm2',
				title: 'Medicines restocked',
				description: '',
				kind: 'goods_delivery',
				dueDate: '2027-01-15',
				ownerKey: 'p2',
				confirmerKey: 'c2'
			}
		],
		people: [
			{
				key: 'p1',
				role: 'third_party',
				name: 'Tradewind Roofing',
				title: 'Roofing contractor',
				email: 'jobs@tradewind.example',
				relationship: '',
				relationshipReason: ''
			},
			{
				key: 'p2',
				role: 'third_party',
				name: 'Island Pharmacy Supply',
				title: 'Medicine supplier',
				email: 'orders@islandpharm.example',
				relationship: '',
				relationshipReason: ''
			},
			{
				key: 'c1',
				role: 'confirmer',
				name: 'Marlon Reid',
				title: 'Parish building inspector',
				email: 'm.reid@parishcouncil.example',
				relationship: 'independent',
				relationshipReason: 'Employed by the parish council. Not paid by the project.'
			},
			{
				key: 'c2',
				role: 'confirmer',
				name: 'Joy Baptiste',
				title: 'Clinic nurse in charge',
				email: 'joy@palmpoint.example',
				relationship: 'stakeholder',
				relationshipReason: ''
			}
		],
		schedule: { cadence: 'weekly' }
	};
}

type Answer = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;

async function post(action: 'check' | 'create', draft: unknown, step?: string): Promise<Answer> {
	const body = new FormData();
	body.set('draft', typeof draft === 'string' ? draft : JSON.stringify(draft));
	if (step !== undefined) body.set('step', step);
	const event = {
		request: new Request('http://localhost/old/campaigns/new', { method: 'POST', body }),
		locals: { ctx: { db: test.db, config } }
	};
	const answer = await actions[action](
		event as unknown as Parameters<(typeof actions)['check']>[0]
	);
	return answer as Answer;
}

/** The field errors of a refused post. */
function errorsOf(answer: Answer): Record<string, string> {
	expect(answer.status).toBe(400);
	return (answer.data?.['errors'] ?? {}) as Record<string, string>;
}

describe('checking one step', () => {
	it('passes each step of a valid draft', async () => {
		for (const step of ['project', 'funding', 'milestones', 'people', 'schedule']) {
			expect(await post('check', validDraft(), step)).toEqual({
				action: 'check',
				step,
				passed: true
			});
		}
	});

	it('refuses a step it does not know, and "review", which is not checked alone', async () => {
		expect((await post('check', validDraft(), 'budget')).status).toBe(400);
		expect((await post('check', validDraft(), 'review')).status).toBe(400);
		expect((await post('check', validDraft())).status).toBe(400);
	});

	it('project: names the missing fields, and only this step’s', async () => {
		const errors = errorsOf(await post('check', {}, 'project'));
		expect(Object.keys(errors).sort()).toEqual([
			'project.creatorEmail',
			'project.creatorName',
			'project.title'
		]);
		expect(errors['project.title']).toBe('Give the project a name.');
	});

	it('project: holds every field to the contract’s length, and the email to an address', async () => {
		const draft = validDraft();
		draft.project.title = 'x'.repeat(201);
		draft.project.summary = 'x'.repeat(2001);
		draft.project.beneficiary = 'x'.repeat(301);
		draft.project.creatorName = 'x'.repeat(201);
		draft.project.creatorEmail = 'not an address';
		expect(errorsOf(await post('check', draft, 'project'))).toEqual({
			'project.title': 'Keep this to 200 characters or fewer.',
			'project.summary': 'Keep this to 2000 characters or fewer.',
			'project.beneficiary': 'Keep this to 300 characters or fewer.',
			'project.creatorName': 'Keep this to 200 characters or fewer.',
			'project.creatorEmail': 'Enter an email address, such as name@example.org.'
		});
	});

	it('funding: reads a goal into the contract’s amount, and refuses what is not one', async () => {
		expect(readGoal('')).toEqual({ ok: true, value: null });
		expect(readGoal('12,000')).toEqual({ ok: true, value: 12_000_000 });
		expect(readGoal('0.125')).toEqual({ ok: true, value: 125 });
		for (const typed of ['abc', '-5', '1.2345', '0', '1e9', '9999999999999']) {
			const draft = validDraft();
			draft.funding.goal = typed;
			expect(Object.keys(errorsOf(await post('check', draft, 'funding')))).toEqual([
				'funding.goal'
			]);
		}
	});

	it('milestones: needs at least one, each with a name, a kind and a real date', async () => {
		const none = validDraft();
		none.milestones = [];
		expect(errorsOf(await post('check', none, 'milestones'))).toEqual({
			'milestones._': 'Add at least one milestone.'
		});

		const bad = {
			...validDraft(),
			milestones: [{ key: 'm1', title: ' ', kind: 'party', dueDate: '2026-02-30' }]
		};
		expect(errorsOf(await post('check', bad, 'milestones'))).toEqual({
			'milestones.m1.title': 'Give the milestone a name.',
			'milestones.m1.kind': 'Choose the kind of milestone.',
			'milestones.m1.dueDate': 'Choose the date this is due.'
		});
	});

	it('people: needs someone to do the work and someone to confirm, each complete', async () => {
		const draft = validDraft();
		draft.people = [];
		const errors = errorsOf(await post('check', draft, 'people'));
		expect(errors['people.third_party']).toBeDefined();
		expect(errors['people.confirmer']).toBeDefined();
		expect(errors['assign.m1.owner']).toBeDefined();
		expect(errors['assign.m1.confirmer']).toBeDefined();

		const partial = validDraft();
		partial.people[2] = { ...partial.people[2]!, name: '', email: 'nope', relationship: '' };
		expect(errorsOf(await post('check', partial, 'people'))).toEqual({
			'people.c1.name': 'Enter a name.',
			'people.c1.email': 'Enter an email address, such as name@example.org.',
			'people.c1.relationship': 'Choose how they are related to the project.'
		});
	});

	it('people: nobody confirms a milestone they do the work on', async () => {
		// The same entry named twice.
		const same = validDraft();
		same.milestones[0]!.confirmerKey = 'p1';
		expect(errorsOf(await post('check', same, 'people'))['assign.m1.confirmer']).toBe(
			'Tradewind Roofing does the work on this milestone, so someone else has to confirm it.'
		);

		// The same person entered twice, once in each role, told apart only by spelling.
		const twice = validDraft();
		twice.people[3]!.email = ' JOBS@tradewind.example';
		twice.milestones[0]!.confirmerKey = 'c2';
		expect(errorsOf(await post('check', twice, 'people'))['assign.m1.confirmer']).toContain(
			'someone else has to confirm it'
		);

		// A confirmer cannot be chosen as the one doing the work either.
		const swapped = validDraft();
		swapped.milestones[0]!.ownerKey = 'c2';
		expect(errorsOf(await post('check', swapped, 'people'))['assign.m1.owner']).toBeDefined();
	});

	it('people: "independent" needs a reason, and is refused for someone who takes part', async () => {
		const bare = validDraft();
		bare.people[2]!.relationshipReason = ' ';
		expect(Object.keys(errorsOf(await post('check', bare, 'people')))).toEqual([
			'people.c1.relationshipReason'
		]);

		const organiser = validDraft();
		organiser.people[2]!.email = 'committee@palmpoint.example';
		expect(errorsOf(await post('check', organiser, 'people'))['people.c1.relationship']).toContain(
			'organiser’s own email'
		);

		const paid = validDraft();
		paid.people[2]!.email = 'orders@islandpharm.example';
		expect(errorsOf(await post('check', paid, 'people'))['people.c1.relationship']).toContain(
			'Someone paid by the project is not independent'
		);
	});

	it('schedule: takes only the contract’s cadences', async () => {
		const draft = { ...validDraft(), schedule: { cadence: 'monthly' } };
		expect(errorsOf(await post('check', draft, 'schedule'))).toEqual({
			'schedule.cadence': 'Choose how often work is reported.'
		});
	});
});

describe('notices', () => {
	it('warns when someone named in "who it is for" is marked independent', () => {
		const draft = validDraft();
		draft.project.beneficiary = 'Marlon Reid and his neighbours';
		const notices = noticesFor(draft);
		expect(notices.find((notice) => notice.kind === 'independent_may_benefit')).toMatchObject({
			key: 'c1',
			title: 'Marlon Reid is marked independent'
		});
		// A warning, not a refusal: the organiser may know better.
		expect(checkDraft(draft).errors).toEqual({});
	});

	it('says which milestones have no independent confirmer, and only those', () => {
		expect(noticesFor(validDraft())).toEqual([
			{
				key: 'm2',
				kind: 'no_independent_confirmer',
				title: 'Milestone 2 has no independent confirmer',
				body: 'That’s allowed. Donors will see Joy Baptiste’s confirmation as a stakeholder confirmation.'
			}
		]);
	});
});

describe('creating the campaign', () => {
	it('writes the campaign as a draft, with its parties and milestones, and nothing else', async () => {
		const answer = await post('create', validDraft());
		const created = answer['created'] as {
			id: string;
			title: string;
			path: string;
			invitations: { name: string; title: string; role: string; url: string }[];
		};

		const stored = await test.db.select().from(campaigns);
		expect(stored).toHaveLength(1);
		const campaign = campaignSchema.parse(stored[0]);
		expect(campaign).toEqual({
			id: created.id,
			title: 'Repair the clinic roof',
			summary: 'The storm lifted half the roof off Palm Point clinic.',
			beneficiary: 'The families of Palm Point',
			creatorName: 'Palm Point Health Committee',
			creatorEmail: 'committee@palmpoint.example',
			status: 'draft',
			cadence: 'weekly',
			logWorkCommodityId: null,
			milestoneHitCommodityId: null,
			fundingGoal: 8_500_500,
			donationCommodityId: null,
			createdAt: NOW
		});
		// The id is the draft's only address, so it ends in 80 random bits.
		expect(campaign.id).toMatch(/^repair-the-clinic-roof-[0-9a-f]{20}$/);

		const people = (await test.db.select().from(parties)).map((row) => partySchema.parse(row));
		expect(people).toHaveLength(4);
		const byName = new Map(people.map((party) => [party.name, party]));
		expect(byName.get('Tradewind Roofing')).toMatchObject({
			campaignId: campaign.id,
			role: 'third_party',
			title: 'Roofing contractor',
			email: 'jobs@tradewind.example',
			relationship: 'participant',
			relationshipReason: null,
			agentWalletHostname: null,
			primaryWalletHostname: null
		});
		expect(byName.get('Marlon Reid')).toMatchObject({
			role: 'confirmer',
			relationship: 'independent',
			relationshipReason: 'Employed by the parish council. Not paid by the project.'
		});
		expect(byName.get('Joy Baptiste')).toMatchObject({
			relationship: 'stakeholder',
			relationshipReason: null
		});
		for (const party of people) expect(party.id).toMatch(/^pty_[0-9a-f-]{36}$/);
		expect(new Set(people.map((party) => party.id)).size).toBe(4);
		expect(new Set(people.map((party) => party.reporterCode)).size).toBe(4);

		const steps = (await test.db.select().from(milestones))
			.map((row) => milestoneSchema.parse(row))
			.sort((a, b) => a.position - b.position);
		expect(steps).toEqual([
			{
				campaignId: campaign.id,
				id: 'm1-roof-replaced',
				position: 1,
				title: 'Roof replaced',
				description: 'New sheeting on the whole roof.',
				kind: 'construction',
				ownerPartyId: byName.get('Tradewind Roofing')?.id,
				confirmerPartyId: byName.get('Marlon Reid')?.id,
				dueDate: '2026-12-18',
				state: 'open',
				confirmedAt: null
			},
			{
				campaignId: campaign.id,
				id: 'm2-medicines-restocked',
				position: 2,
				title: 'Medicines restocked',
				description: '',
				kind: 'goods_delivery',
				ownerPartyId: byName.get('Island Pharmacy Supply')?.id,
				confirmerPartyId: byName.get('Joy Baptiste')?.id,
				dueDate: '2027-01-15',
				state: 'open',
				confirmedAt: null
			}
		]);

		// What the organiser is shown: the page, and one invitation link per person, in the App.
		expect(created.title).toBe('Repair the clinic roof');
		expect(created.path).toBe(`/campaigns/${campaign.id}`);
		expect(created.invitations).toEqual(
			people.map((party) => ({
				name: party.name,
				title: party.title,
				role: party.role,
				url: `https://app.tejido.example/invite/${party.id}`
			}))
		);
		// No email address and no private filing code is sent back.
		const sent = JSON.stringify(answer);
		expect(sent).not.toContain('@');
		expect(sent).not.toMatch(/rc_/);
	});

	it('creates nothing while anything is wrong, and says what, across every step', async () => {
		const draft = validDraft();
		draft.project.title = '';
		draft.schedule.cadence = '';
		draft.milestones[1]!.confirmerKey = 'p2';
		const errors = errorsOf(await post('create', draft));
		expect(Object.keys(errors).sort()).toEqual([
			'assign.m2.confirmer',
			'project.title',
			'schedule.cadence'
		]);
		expect(await test.db.select().from(campaigns)).toEqual([]);
		expect(await test.db.select().from(parties)).toEqual([]);
	});

	it('reads anything that is not a draft as an empty one', async () => {
		for (const sent of ['not json', '[]', '"text"', 'null', 'x'.repeat(200_001)]) {
			expect(errorsOf(await post('create', sent))['project.title']).toBeDefined();
		}
		expect(
			reviveDraft({ people: [{ key: '../x' }, { key: 'a' }, { key: 'a' }] }).people
		).toHaveLength(1);
		expect(await test.db.select().from(campaigns)).toEqual([]);
	});

	it('refuses more milestones than a campaign can be created with', async () => {
		const draft = validDraft();
		const first = draft.milestones[0]!;
		draft.milestones = Array.from({ length: 30 }, (_, index) => ({ ...first, key: `m${index}` }));
		expect(errorsOf(await post('create', draft))['milestones._']).toBe(
			'A campaign can be created with at most 20 milestones.'
		);
	});

	it('gives a title with no letters an id all the same', async () => {
		const draft = validDraft();
		draft.project.title = '学校の屋根';
		draft.milestones[0]!.title = '屋根';
		const answer = await post('create', draft);
		expect((answer['created'] as { id: string }).id).toMatch(/^campaign-[0-9a-f]{20}$/);
		const ids = (await test.db.select().from(milestones)).map((row) => row.id).sort();
		expect(ids).toEqual(['m1', 'm2-medicines-restocked']);
	});

	it(`stops after ${CREATED_PER_HOUR} campaigns in an hour, and starts again when the hour has passed`, async () => {
		for (let made = 0; made < CREATED_PER_HOUR; made += 1) {
			expect((await post('create', validDraft()))['created']).toBeDefined();
		}
		const refused = await post('create', validDraft());
		expect(refused.status).toBe(429);
		expect(refused.data?.['refused']).toContain('at most 20 campaigns an hour');
		expect(await test.db.select().from(campaigns)).toHaveLength(CREATED_PER_HOUR);

		vi.setSystemTime(new Date('2026-11-14T13:00:01.000Z'));
		expect((await post('create', validDraft()))['created']).toBeDefined();
	}, 60_000);

	it('leaves a created campaign off the home page, which is sent no email address', async () => {
		await post('create', validDraft());
		const event = { locals: { ctx: { db: test.db } } };
		const data = await home(event as unknown as Parameters<typeof home>[0]);
		expect(data).toEqual({ campaigns: [] });
		expect(JSON.stringify(data)).not.toContain('@');
	});
});
