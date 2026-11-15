import { describe, expect, it } from 'vitest';
import { parseE2eConfig } from './config.ts';
import {
	runCampaignFromAnswer,
	runCampaignRequest,
	runCampaignTitle,
	withRunCampaign
} from './run-campaign.ts';

const env = {
	E2E_QATOM_HOST: 'pay.m.todaq.net',
	E2E_INBOX_QUEUE_URL: 'https://sqs.ca-central-1.amazonaws.com/123456789012/e2e-inbox',
	E2E_INBOX_REGION: 'ca-central-1',
	E2E_INBOX_DOMAIN: 'e2e.m.todaq.net',
	E2E_CAMPAIGN_ID: 'e2e-smoke',
	E2E_CONTRACTOR_PARTY_ID: 'e2e-contractor',
	E2E_CONFIRMER_PARTY_ID: 'e2e-confirmer'
};
const now = new Date('2026-11-15T09:00:00Z');
const answer = {
	campaign: {
		id: 'automatic-test-run-40-3f9a1c0b7d2e4a6f8b1c',
		invitations: [
			{ role: 'third_party', url: 'https://app.tejido.net/invite/pty_0b6f3c1e-8a52' },
			{ role: 'confirmer', url: 'https://app.tejido.net/invite/pty_a47c1f08-6e2b' }
		]
	}
};

describe('the campaign a paid run creates', () => {
	it('is titled as an automatic test of a named run', () => {
		expect(runCampaignTitle('40', now)).toBe('Automatic test, run 40 (not a real fundraiser)');
		expect(runCampaignTitle(null, now)).toBe(
			'Automatic test, 2026-11-15 09:00 (not a real fundraiser)'
		);
	});

	it('invites the two test people at their own addresses, to the fixture’s three milestones', () => {
		const request = runCampaignRequest(parseE2eConfig({ ...env, E2E_RUN_LABEL: '40' }), now) as {
			people: { role: string; email: string }[];
			milestones: { title: string; kind: string; dueDate: string }[];
		};
		expect(request.people.map(({ role, email }) => [role, email])).toEqual([
			['third_party', 'e2e-contractor@e2e.m.todaq.net'],
			['confirmer', 'e2e-confirmer@e2e.m.todaq.net']
		]);
		expect(request.milestones.map(({ title, kind }) => [title, kind])).toEqual([
			['Test milestone 1: work', 'service'],
			['Test milestone 2: a delivery', 'goods_delivery'],
			['Test milestone 3: a build', 'construction']
		]);
		expect(request.milestones[0]?.dueDate).toBe('2027-11-15');
	});

	it('reads the campaign and its two people from the API’s answer', () => {
		expect(runCampaignFromAnswer(answer, 'https://app.tejido.net')).toEqual({
			campaignId: 'automatic-test-run-40-3f9a1c0b7d2e4a6f8b1c',
			contractorPartyId: 'pty_0b6f3c1e-8a52',
			confirmerPartyId: 'pty_a47c1f08-6e2b'
		});
	});

	it('refuses an answer whose invitations are not on the App, or are not one each', () => {
		expect(() => runCampaignFromAnswer(answer, 'https://app.example.org')).toThrow(/on the App/);
		const two = {
			campaign: { ...answer.campaign, invitations: [answer.campaign.invitations[0]] }
		};
		expect(() => runCampaignFromAnswer(two, 'https://app.tejido.net')).toThrow(/confirmer/);
	});

	it('replaces the fixed campaign on a paid run only', () => {
		const created = runCampaignFromAnswer(answer, 'https://app.tejido.net');
		const unpaid = parseE2eConfig(env);
		expect(withRunCampaign(unpaid, created)).toBe(unpaid);

		const paid = withRunCampaign(parseE2eConfig({ ...env, E2E_PAID: 'true' }), created);
		expect(paid.campaignId).toBe(created.campaignId);
		expect(paid.contractor).toEqual({
			partyId: 'pty_0b6f3c1e-8a52',
			email: 'e2e-contractor@e2e.m.todaq.net'
		});
		expect(paid.confirmer.partyId).toBe('pty_a47c1f08-6e2b');
	});
});
