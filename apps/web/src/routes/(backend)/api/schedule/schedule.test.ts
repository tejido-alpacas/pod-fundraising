// Runs the cadence scheduler through its route against a real, migrated, seeded database.
// Nothing here reaches the network: `fetch` is replaced, in this file only, by a stub that
// fails the test if anything calls it. Only the clock's date is set, so "now" is known.
//
// The seeded campaign is `reporting`, weekly. Its contractor owes m2-walls (open, due 27
// November), its supplier's m3-books-delivered is claimed (due 20 November, the head teacher
// confirms), and m1-foundation is confirmed. Its work logs were filed on 6 and 13 November.
import { CHECKIN_SECRET_HEADER, type CampaignStatus } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	campaigns,
	entries,
	getWorkLogStart,
	listReminders,
	milestones,
	reminders
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaisedReminder, ScheduleSummary } from '#lib/server/backend/schedule.ts';
import { POST } from './+server.ts';

const SECRET = 'test-checkin-secret-test-checkin-secret';
const APP = 'https://app.tejido.example';
const CAMPAIGN = fixtures.campaign.id;
/** The first pass in most tests: a Sunday. The first work-log period is then 15 to 21 November. */
const FIRST_PASS = '2026-11-15T10:00:00.000Z';

const contractor = fixtures.parties[0]!;
const headTeacher = fixtures.parties[2]!;
const fixtureWorkLog = fixtures.entries.find((entry) => entry.id === 'ent-m2-log-2')!;

let test: TestDatabase;
let fetched: string[];

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	fetched = [];
	vi.stubGlobal('fetch', (url: string | URL) => {
		fetched.push(String(url));
		return Promise.reject(new Error(`unexpected request: ${String(url)}`));
	});
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(FIRST_PASS));
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await test.destroy();
});

async function run(
	at: string = FIRST_PASS,
	headers: Record<string, string> = { [CHECKIN_SECRET_HEADER]: SECRET }
) {
	vi.setSystemTime(new Date(at));
	const request = new Request('http://localhost/api/schedule', { method: 'POST', headers });
	const locals = {
		ctx: {
			db: test.db,
			config: { CHECKIN_SHARED_SECRET: SECRET, OIDC_REDIRECT_URI: `${APP}/auth/callback` }
		}
	};
	const response = await POST({ request, locals } as unknown as Parameters<typeof POST>[0]);
	const text = await response.text();
	return { status: response.status, text, body: JSON.parse(text) as ScheduleSummary };
}

const stored = () => listReminders(test.db, CAMPAIGN);

async function setStatus(status: CampaignStatus) {
	await test.db.update(campaigns).set({ status }).where(eq(campaigns.id, CAMPAIGN));
}

/** The contractor files a work log at `filedAt`. */
async function fileWorkLog(id: string, filedAt: string) {
	await test.db
		.insert(entries)
		.values({ ...fixtureWorkLog, id, twistId: null, filedAt, updatedAt: filedAt });
}

/** What a reminder is about, in a few words, for comparing lists. */
const brief = (reminder: RaisedReminder) =>
	`${reminder.party.id} ${reminder.kind} ${reminder.milestoneId ?? reminder.period?.start}`;

describe('POST /api/schedule', () => {
	it('refuses a caller without the shared secret, and records nothing', async () => {
		expect((await run(FIRST_PASS, {})).status).toBe(401);
		expect((await run(FIRST_PASS, { [CHECKIN_SECRET_HEADER]: 'wrong' })).status).toBe(401);
		expect((await run(FIRST_PASS, { [CHECKIN_SECRET_HEADER]: `${SECRET}x` })).status).toBe(401);

		expect(await stored()).toEqual([]);
		expect(await getWorkLogStart(test.db, CAMPAIGN)).toBeNull();
	});

	it('records what is due on a first pass, each with the link to follow', async () => {
		const { status, body } = await run();

		expect(status).toBe(200);
		expect(body).toEqual({
			ranAt: FIRST_PASS,
			today: '2026-11-15',
			campaigns: 1,
			due: 2,
			overdue: 0,
			remindersRecorded: 2,
			reminders: [
				{
					id: expect.stringMatching(/^rem_/),
					campaignId: CAMPAIGN,
					party: { id: headTeacher.id, name: headTeacher.name },
					what: 'milestone',
					kind: 'due',
					milestoneId: 'm3-books-delivered',
					action: 'confirm',
					period: null,
					dueDate: '2026-11-20',
					overdueDays: 0,
					raisedAt: FIRST_PASS,
					link: `${APP}/reminder?milestone=m3-books-delivered&party=head-teacher`
				},
				{
					id: expect.stringMatching(/^rem_/),
					campaignId: CAMPAIGN,
					party: { id: contractor.id, name: contractor.name },
					what: 'work_log',
					kind: 'due',
					milestoneId: null,
					action: 'log_work',
					period: { number: 1, start: '2026-11-15', end: '2026-11-21' },
					dueDate: '2026-11-21',
					overdueDays: 0,
					raisedAt: FIRST_PASS,
					link: `${APP}/reminder?party=contractor`
				}
			]
		} satisfies ScheduleSummary);

		// What is stored is what was answered.
		expect((await stored()).map((row) => row.id).sort()).toEqual(
			body.reminders.map((reminder) => reminder.id).sort()
		);
		expect(await getWorkLogStart(test.db, CAMPAIGN)).toBe('2026-11-15');
	});

	it('records nothing twice when run again in the same period', async () => {
		const first = await run();
		const before = await stored();

		const again = await run('2026-11-15T10:00:05.000Z');
		const nextDay = await run('2026-11-16T03:00:00.000Z');
		const lastDayOfPeriod = await run('2026-11-19T23:59:59.999Z');

		for (const pass of [again, nextDay, lastDayOfPeriod]) {
			expect(pass.status).toBe(200);
			// Still due, and counted; no longer new.
			expect(pass.body).toMatchObject({ due: 2, overdue: 0, remindersRecorded: 0, reminders: [] });
		}
		expect(first.body.remindersRecorded).toBe(2);
		expect(await stored()).toEqual(before);
	});

	it('records each thing once as it falls due and once as it becomes overdue', async () => {
		await run();

		// One week before its date, the open milestone is raised with its owner.
		const twentieth = await run('2026-11-20T00:00:00.000Z');
		expect(twentieth.body.reminders).toMatchObject([
			{
				party: { id: contractor.id },
				kind: 'due',
				action: 'claim',
				milestoneId: 'm2-walls',
				dueDate: '2026-11-27',
				link: `${APP}/reminder?milestone=m2-walls&party=contractor`
			}
		]);

		// The day after its date, the claimed milestone is overdue with its confirmer.
		const twentyFirst = await run('2026-11-21T00:00:00.000Z');
		expect(twentyFirst.body).toMatchObject({ due: 2, overdue: 1 });
		expect(twentyFirst.body.reminders).toMatchObject([
			{
				party: { id: headTeacher.id },
				kind: 'overdue',
				action: 'confirm',
				milestoneId: 'm3-books-delivered',
				overdueDays: 1,
				link: `${APP}/reminder?milestone=m3-books-delivered&party=head-teacher`
			}
		]);

		// The first period ended with no work log: it is overdue, and the second is due.
		const twentySecond = await run('2026-11-22T00:00:00.000Z');
		expect(twentySecond.body.reminders.map(brief)).toEqual([
			'contractor overdue 2026-11-15',
			'contractor due 2026-11-22'
		]);
		expect(twentySecond.body.reminders[0]).toMatchObject({
			what: 'work_log',
			dueDate: '2026-11-21',
			overdueDays: 1,
			link: `${APP}/reminder?party=contractor`
		});

		expect((await run('2026-11-22T18:00:00.000Z')).body.reminders).toEqual([]);
		expect(await stored()).toHaveLength(6);
	});

	it('raises no overdue work log for a period a work log was filed in', async () => {
		await run();
		await fileWorkLog('ent-in-period-1', '2026-11-18T09:00:00.000Z');

		const { body } = await run('2026-11-22T00:00:00.000Z');

		expect(body.reminders.map(brief)).toEqual([
			'contractor due m2-walls',
			'head-teacher overdue m3-books-delivered',
			'contractor due 2026-11-22'
		]);
	});

	it('stops asking once a milestone is confirmed', async () => {
		await run();
		await test.db
			.update(milestones)
			.set({ state: 'confirmed_independent', confirmedAt: '2026-11-19T09:00:00.000Z' })
			.where(and(eq(milestones.campaignId, CAMPAIGN), eq(milestones.id, 'm3-books-delivered')));

		const { body } = await run('2026-11-21T00:00:00.000Z');

		expect(body.overdue).toBe(0);
		expect(body.reminders.map(brief)).toEqual(['contractor due m2-walls']);
	});

	it('never looks at a draft campaign', async () => {
		await setStatus('draft');

		const { status, body } = await run('2026-12-25T00:00:00.000Z');

		expect(status).toBe(200);
		expect(body).toMatchObject({ campaigns: 0, due: 0, overdue: 0, reminders: [] });
		expect(await stored()).toEqual([]);
		expect(await getWorkLogStart(test.db, CAMPAIGN)).toBeNull();
	});

	it('raises milestones but no work logs for a campaign whose work is not under way', async () => {
		await setStatus('funded');

		const { body } = await run('2026-11-21T00:00:00.000Z');

		expect(body.reminders.map(brief)).toEqual([
			'contractor due m2-walls',
			'head-teacher overdue m3-books-delivered'
		]);
		expect(await getWorkLogStart(test.db, CAMPAIGN)).toBeNull();
	});

	it('counts work-log periods from the first pass that saw work under way, and never moves it', async () => {
		await run('2026-11-17T10:00:00.000Z');
		await run('2026-11-23T10:00:00.000Z');

		expect(await getWorkLogStart(test.db, CAMPAIGN)).toBe('2026-11-17');
		// 23 November is the last day of the first period (17 to 23), so nothing is overdue yet.
		const workLogs = await test.db.select().from(reminders).where(eq(reminders.what, 'work_log'));
		expect(workLogs).toMatchObject([{ subject: '2026-11-17', kind: 'due', dueDate: '2026-11-23' }]);
	});

	it('puts no email address, filing code or wallet in the answer, and logs nothing', async () => {
		const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
			vi.spyOn(console, method)
		);

		const first = await run();
		const later = await run('2026-11-29T00:00:00.000Z');

		expect(later.body.remindersRecorded).toBeGreaterThan(0);
		for (const { text } of [first, later]) {
			for (const party of fixtures.parties) {
				expect(text).not.toContain(party.email);
				expect(text).not.toContain(party.reporterCode);
				expect(text).not.toContain(party.agentWalletHostname);
				expect(text).not.toContain(party.primaryWalletHostname);
			}
			expect(text).not.toContain(fixtures.campaign.creatorEmail);
			expect(text).not.toMatch(/@|rc_|wallet/i);
		}
		for (const spy of logged) expect(spy).not.toHaveBeenCalled();
	});

	it('calls nothing outside our own database: not Qatom, not a mailer', async () => {
		await run();
		await run('2026-11-29T00:00:00.000Z');

		expect(fetched).toEqual([]);
	});

	it('changes no campaign, milestone or entry', async () => {
		const snapshot = async () => ({
			campaigns: await test.db.select().from(campaigns),
			milestones: await test.db.select().from(milestones),
			entries: await test.db.select().from(entries)
		});
		const before = await snapshot();

		await run();
		await run('2026-11-29T00:00:00.000Z');

		expect(await snapshot()).toEqual(before);
	});
});
