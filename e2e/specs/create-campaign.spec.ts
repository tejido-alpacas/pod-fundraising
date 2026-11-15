/**
 * A PAID RUN ONLY (`E2E_PAID=true`): creates the campaign this run tells its story on, through
 * the campaign API as documented (docs/campaign-api.md), with the two test people invited at
 * their two test addresses. Every later check in the run then uses this campaign in place of
 * the fixed test campaign, so each paid run files on milestones nobody has filed on.
 *
 * THIS WRITES TO THE LIVE DATABASE: one draft campaign, its two people and three milestones,
 * which nothing can delete. It is on no public list, and its title says it is an automatic test
 * and which run made it. An unpaid run creates nothing.
 *
 * Never retried: a second try would create a second campaign.
 */
import { expect, test } from '../lib/harness.ts';
import { runCampaignFromAnswer, runCampaignRequest, saveRunCampaign } from '../lib/run-campaign.ts';

test.describe.configure({ retries: 0 });

test('a paid run creates the campaign it files on', async ({ playwright, cfg }, testInfo) => {
	test.skip(!cfg.paid, 'Not a paid run: it walks the fixed test campaign and creates nothing.');
	expect(testInfo.retry, 'Creating a campaign must never be retried.').toBe(0);

	const api = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
	try {
		const answer = await api.post(`${cfg.siteUrl}/api/campaigns`, {
			data: runCampaignRequest(cfg)
		});
		const body: unknown = await answer.json().catch(() => null);
		expect(
			answer.status(),
			`The campaign API did not create the campaign. It answered: ${JSON.stringify(body).slice(0, 600)}`
		).toBe(201);

		const created = runCampaignFromAnswer(body, cfg.appUrl);
		saveRunCampaign(created);
		// Not a secret: the campaign's page can be opened by anyone who has this address.
		console.log(`This run's own campaign: ${cfg.siteUrl}/campaigns/${created.campaignId}`);
	} finally {
		await api.dispose();
	}
});
