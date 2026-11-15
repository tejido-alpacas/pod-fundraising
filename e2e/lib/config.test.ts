import { describe, expect, it } from 'vitest';
import { E2eConfigError, parseE2eConfig } from './config.ts';

const complete = {
	E2E_QATOM_HOST: 'pay.m.todaq.net',
	E2E_INBOX_QUEUE_URL: 'https://sqs.ca-central-1.amazonaws.com/123456789012/e2e-inbox',
	E2E_INBOX_REGION: 'ca-central-1',
	E2E_INBOX_DOMAIN: 'e2e.m.todaq.net',
	E2E_CAMPAIGN_ID: 'e2e-smoke',
	E2E_CONTRACTOR_PARTY_ID: 'e2e-contractor',
	E2E_CONFIRMER_PARTY_ID: 'e2e-confirmer'
};

function refusal(env: Record<string, string | undefined>): E2eConfigError {
	try {
		parseE2eConfig(env);
	} catch (error) {
		if (error instanceof E2eConfigError) return error;
		throw error;
	}
	throw new Error('Expected the configuration to be refused.');
}

describe('parseE2eConfig', () => {
	it('defaults to the live site and builds the two fixed test people', () => {
		const config = parseE2eConfig(complete);
		expect(config.appUrl).toBe('https://app.tejido.net');
		expect(config.siteUrl).toBe('https://tejido.net');
		expect(config.contractor).toEqual({
			partyId: 'e2e-contractor',
			email: 'e2e-contractor@e2e.m.todaq.net'
		});
		expect(config.confirmer.email).toBe('e2e-confirmer@e2e.m.todaq.net');
		expect(config.donor).toEqual({ email: 'e2e-donor@e2e.m.todaq.net' });
		expect(config.allowOtherHosts).toBe(false);
		expect(config.paid).toBe(false);
	});

	it('turns the paid spec on only for exactly "true"', () => {
		expect(parseE2eConfig({ ...complete, E2E_PAID: 'true' }).paid).toBe(true);
		for (const value of ['TRUE', '1', 'yes', 'false', ' ', undefined]) {
			expect(parseE2eConfig({ ...complete, E2E_PAID: value }).paid).toBe(false);
		}
	});

	it('turns the paid donation on only for exactly "true", and never from E2E_PAID', () => {
		expect(parseE2eConfig(complete).paidDonation).toBe(false);
		expect(parseE2eConfig(complete).donationCampaignId).toBeNull();
		expect(parseE2eConfig({ ...complete, E2E_PAID: 'true' }).paidDonation).toBe(false);
		expect(parseE2eConfig({ ...complete, E2E_PAID_DONATION: 'true' }).paidDonation).toBe(true);
		expect(parseE2eConfig({ ...complete, E2E_PAID_DONATION: 'true' }).paid).toBe(false);
		for (const value of ['TRUE', '1', 'yes', 'false', ' ', undefined]) {
			expect(parseE2eConfig({ ...complete, E2E_PAID_DONATION: value }).paidDonation).toBe(false);
		}
	});

	it('reads the campaign a paid donation may give to, and refuses one that is not an id', () => {
		const config = parseE2eConfig({ ...complete, E2E_DONATION_CAMPAIGN_ID: 'e2e-giving' });
		expect(config.donationCampaignId).toBe('e2e-giving');
		expect(config.campaignId).toBe('e2e-smoke');
		expect(refusal({ ...complete, E2E_DONATION_CAMPAIGN_ID: 'Not An Id' }).names).toEqual([
			'E2E_DONATION_CAMPAIGN_ID'
		]);
	});

	it('signs in unless told not to with exactly "true"', () => {
		expect(parseE2eConfig(complete).signIn).toBe(true);
		expect(parseE2eConfig({ ...complete, E2E_SKIP_SIGN_IN: 'true' }).signIn).toBe(false);
		for (const value of ['TRUE', '1', 'yes', 'false', ' ', undefined]) {
			expect(parseE2eConfig({ ...complete, E2E_SKIP_SIGN_IN: value }).signIn).toBe(true);
		}
	});

	it('creates a campaign only for exactly "true"', () => {
		expect(parseE2eConfig({ ...complete, E2E_CREATE_CAMPAIGN: 'true' }).createCampaign).toBe(true);
		for (const value of ['TRUE', '1', 'yes', 'false', ' ', undefined]) {
			expect(parseE2eConfig({ ...complete, E2E_CREATE_CAMPAIGN: value }).createCampaign).toBe(
				false
			);
		}
	});

	it('names every missing value at once, and no value', () => {
		const error = refusal({ E2E_INBOX_DOMAIN: 'e2e.m.todaq.net' });
		expect(error.names).toEqual([
			'E2E_QATOM_HOST',
			'E2E_INBOX_QUEUE_URL',
			'E2E_INBOX_REGION',
			'E2E_CAMPAIGN_ID',
			'E2E_CONTRACTOR_PARTY_ID',
			'E2E_CONFIRMER_PARTY_ID'
		]);
		expect(error.message).toMatch(/E2E_INBOX_QUEUE_URL +is not set/);
		expect(error.message).not.toContain('e2e.m.todaq.net');
	});

	it('treats a blank value as missing', () => {
		expect(refusal({ ...complete, E2E_CAMPAIGN_ID: '  ' }).names).toEqual(['E2E_CAMPAIGN_ID']);
	});

	it('refuses malformed values without repeating them', () => {
		const error = refusal({
			...complete,
			E2E_APP_URL: 'https://app.tejido.net/chat',
			E2E_INBOX_QUEUE_URL: 'http://sqs.example/queue',
			E2E_INBOX_DOMAIN: 'https://e2e.m.todaq.net',
			E2E_INBOX_REGION: 'canada'
		});
		expect(error.names.sort()).toEqual([
			'E2E_APP_URL',
			'E2E_INBOX_DOMAIN',
			'E2E_INBOX_QUEUE_URL',
			'E2E_INBOX_REGION'
		]);
		expect(error.message).not.toContain('sqs.example');
	});
});
