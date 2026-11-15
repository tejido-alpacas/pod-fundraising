/**
 * The campaign builder, as far as it goes without creating anything. A creator opens it, is
 * told what is missing, fills in the first step and reaches the second. The answers stay in
 * this browser; "Continue" only asks the site to check them. "Create campaign" is on the last
 * step, which this spec never opens, so nothing is written to the live database.
 *
 * The same for the campaign API (docs/campaign-api.md): only `POST /api/campaigns/check` is
 * called, which saves nothing. `POST /api/campaigns`, which creates, is never called here.
 */
import { expect, test } from '../lib/harness.ts';

test.use({ storageState: { cookies: [], origins: [] } });

test('the builder checks the first step and moves to the second, creating nothing', async ({
	page,
	cfg,
	waypoint
}) => {
	await page.goto(`${cfg.siteUrl}/campaigns/new`);
	await expect(page).toHaveTitle('Start a campaign · Tejido');
	const heading = page.getByRole('heading', { level: 1 });
	await expect(heading).toHaveText('What is the project?');
	await expect(page.getByText('Step 1 of 6 · Project')).toBeVisible();
	await waypoint(page, 'project-empty');

	// Continue with nothing filled in: the page lists what is missing and stays on this step.
	// The button only works once the page's script runs, so press until the list appears.
	const onward = page.getByRole('button', { name: 'Continue to funding' });
	const problems = page.getByRole('alert').filter({ hasText: /needs? fixing/ });
	await expect(async () => {
		await onward.click();
		await expect(problems).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 45_000 });
	await expect(problems).toContainText('Give the project a name.');
	await expect(heading).toHaveText('What is the project?');
	await waypoint(page, 'project-problems');

	// Fill the step in. These answers are checked and kept in this browser, not stored by Tejido.
	await page.getByLabel('Project name').fill('Automated test, not a real project');
	await page.getByLabel('What it is').fill('An automated check of the campaign builder.');
	await page.getByLabel('Who it is for').fill('Nobody: this is a test');
	await page.getByLabel('Your name, or your group’s').fill('Tejido automated test');
	await page.getByLabel('Your email').fill('automated-test@example.org');
	await onward.click();
	await expect(heading).toHaveText('How much does the project need?');
	await expect(page).toHaveURL(`${cfg.siteUrl}/campaigns/new?step=funding`);
	await expect(page.getByText('Step 2 of 6 · Funding')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create campaign' })).toHaveCount(0);
	await waypoint(page, 'funding');

	// Back keeps what was typed.
	await page.getByRole('link', { name: 'Back' }).click();
	await expect(heading).toHaveText('What is the project?');
	await expect(page.getByLabel('Project name')).toHaveValue('Automated test, not a real project');
});

/** A date this many days from now, as the API reads dates. */
function inDays(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The complete example from docs/campaign-api.md, with due dates that are always ahead. */
function completeCampaign(): Record<string, unknown> {
	const person = (key: string, role: string, name: string, title: string, email: string) => ({
		key,
		role,
		name,
		title,
		email,
		relationship: '',
		relationshipReason: ''
	});
	return {
		project: {
			title: 'Automated test, not a real project',
			summary: 'An automated check of the campaign API. Nothing is created.',
			beneficiary: 'Nobody: this is a test',
			creatorName: 'Tejido automated test',
			creatorEmail: 'automated-test@example.org'
		},
		funding: { goal: '8,500.50' },
		milestones: [
			{
				key: 'm1',
				title: 'Roof replaced',
				description: 'New sheeting on the whole roof.',
				kind: 'construction',
				dueDate: inDays(60),
				ownerKey: 'p1',
				confirmerKey: 'c1'
			},
			{
				key: 'm2',
				title: 'Medicines restocked',
				description: '',
				kind: 'goods_delivery',
				dueDate: inDays(90),
				ownerKey: 'p2',
				confirmerKey: 'c2'
			}
		],
		people: [
			person('p1', 'third_party', 'Test Roofing', 'Roofing contractor', 'jobs@roofing.example'),
			person('p2', 'third_party', 'Test Pharmacy', 'Medicine supplier', 'orders@pharmacy.example'),
			{
				...person(
					'c1',
					'confirmer',
					'Test Inspector',
					'Building inspector',
					'inspector@council.example'
				),
				relationship: 'independent',
				relationshipReason: 'Employed by the council. Not paid by the project.'
			},
			{
				...person('c2', 'confirmer', 'Test Nurse', 'Nurse in charge', 'nurse@clinic.example'),
				relationship: 'stakeholder'
			}
		],
		schedule: { cadence: 'weekly' }
	};
}

test('the campaign API checks a campaign and saves nothing', async ({ page, cfg }) => {
	const check = `${cfg.siteUrl}/api/campaigns/check`;

	const whole = await page.request.post(check, { data: completeCampaign() });
	expect(whole.status()).toBe(200);
	expect(await whole.json()).toMatchObject({ ok: true, fields: {} });

	const empty = await page.request.post(check, { data: {} });
	expect(empty.status()).toBe(200);
	const problems = (await empty.json()) as { ok: boolean; fields: Record<string, string> };
	expect(problems.ok).toBe(false);
	expect(problems.fields['project.title']).toBe('Give the project a name.');

	// One screen at a time: with nothing sent, the funding step alone may still continue,
	// because a goal is optional.
	const funding = await page.request.post(`${check}?step=funding`, { data: {} });
	expect(funding.status()).toBe(200);
	expect(await funding.json()).toMatchObject({ ok: true, fields: {} });

	const wrongStep = await page.request.post(`${check}?step=review`, { data: {} });
	expect(wrongStep.status()).toBe(400);
	expect(await wrongStep.json()).toMatchObject({ error: 'invalid_step' });
});
