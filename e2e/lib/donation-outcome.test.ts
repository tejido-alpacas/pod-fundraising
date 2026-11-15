import { describe, expect, it } from 'vitest';
import { parseE2eConfig } from './config.ts';
import {
	asksForCard,
	describeCheckoutScreen,
	donationRunRefusal,
	ENDINGS,
	fundingFromWords,
	fundingMove,
	nothingPaid,
	quietly,
	speaksOfFunds,
	thousandths,
	topUpNeeded,
	withoutAddresses,
	written,
	type SeenField
} from './donation-outcome.ts';
import type { SeenPage } from './stuck-page.ts';

const base = {
	E2E_QATOM_HOST: 'pay.m.todaq.net',
	E2E_INBOX_QUEUE_URL: 'https://sqs.ca-central-1.amazonaws.com/123456789012/e2e-inbox',
	E2E_INBOX_REGION: 'ca-central-1',
	E2E_INBOX_DOMAIN: 'e2e.m.todaq.net',
	E2E_CAMPAIGN_ID: 'e2e-smoke',
	E2E_CONTRACTOR_PARTY_ID: 'e2e-contractor',
	E2E_CONFIRMER_PARTY_ID: 'e2e-confirmer'
};
const on = { ...base, E2E_PAID_DONATION: 'true', E2E_DONATION_CAMPAIGN_ID: 'e2e-giving' };

describe('donationRunRefusal', () => {
	it('pays nothing on an ordinary run, and says so', () => {
		const refusal = donationRunRefusal(parseE2eConfig(base));
		expect(refusal).toEqual({ skip: expect.stringContaining('NO DONATION WAS PAID') });
	});

	it('is not switched on by the paid story’s switch, or by the campaign alone', () => {
		expect(donationRunRefusal(parseE2eConfig({ ...base, E2E_PAID: 'true' }))).toHaveProperty(
			'skip'
		);
		expect(
			donationRunRefusal(parseE2eConfig({ ...base, E2E_DONATION_CAMPAIGN_ID: 'e2e-giving' }))
		).toHaveProperty('skip');
	});

	it('pays nothing on a run that asks Qatom for no code', () => {
		const refusal = donationRunRefusal(parseE2eConfig({ ...on, E2E_SKIP_SIGN_IN: 'true' }));
		expect(refusal).toEqual({ skip: expect.stringContaining('NO DONATION WAS PAID') });
	});

	it('refuses any site but the live one, even when other hosts are allowed', () => {
		const refusal = donationRunRefusal(
			parseE2eConfig({
				...on,
				E2E_SITE_URL: 'http://localhost:5173',
				E2E_ALLOW_OTHER_HOSTS: 'true'
			})
		);
		expect(refusal).toEqual({ fail: expect.stringContaining('NOTHING WAS PAID') });
	});

	it('refuses to run without the one campaign it may give to', () => {
		const refusal = donationRunRefusal(parseE2eConfig({ ...base, E2E_PAID_DONATION: 'true' }));
		expect(refusal).toEqual({ fail: expect.stringContaining('E2E_DONATION_CAMPAIGN_ID') });
	});

	it('allows only the switch, the campaign, the live site and a signing run together', () => {
		expect(donationRunRefusal(parseE2eConfig(on))).toBeNull();
	});
});

describe('reading the Funding block', () => {
	it('reads amounts as thousandths', () => {
		expect(thousandths('1.00')).toBe(1000);
		expect(thousandths('0.125')).toBe(125);
		expect(thousandths('12,000.50')).toBe(12_000_500);
		expect(thousandths('1')).toBeNull();
		expect(thousandths('1.0000')).toBeNull();
		expect(thousandths('about 1.00')).toBeNull();
	});

	it('writes them back as the pages do', () => {
		expect(written(1000)).toBe('1.00');
		expect(written(100)).toBe('0.10');
		expect(written(125)).toBe('0.125');
		expect(written(0)).toBe('0.00');
	});

	it('takes no block as nothing raised yet', () => {
		expect(fundingFromWords(null)).toEqual({ raised: 0, contributions: 0 });
	});

	it('reads the block with and without a goal', () => {
		expect(
			fundingFromWords('Funding\n1.00\nUSD-TDN raised\n1 contribution · no goal has been set')
		).toEqual({ raised: 1000, contributions: 1 });
		expect(
			fundingFromWords(
				'Funding\n1,234.50 USD-TDN raised of 5,000.00 goal\n24% funded · 1,012 contributions'
			)
		).toEqual({ raised: 1_234_500, contributions: 1012 });
	});

	it('never reads words it does not understand as zero', () => {
		expect(() => fundingFromWords('Funding is not known yet')).toThrow(/could not be read/);
	});
});

describe('fundingMove', () => {
	const before = { raised: 3000, contributions: 3 };

	it('sees no change', () => {
		expect(fundingMove(before, { ...before })).toBe('unchanged');
	});

	it('sees exactly one donation of the amount', () => {
		expect(fundingMove(before, { raised: 4000, contributions: 4 })).toBe('recorded');
		expect(fundingMove({ raised: 0, contributions: 0 }, { raised: 1000, contributions: 1 })).toBe(
			'recorded'
		);
	});

	it('never passes off anything else as this donation', () => {
		expect(fundingMove(before, { raised: 5000, contributions: 5 })).toBe('other');
		expect(fundingMove(before, { raised: 4000, contributions: 3 })).toBe('other');
		expect(fundingMove(before, { raised: 13_000, contributions: 4 })).toBe('other');
		expect(fundingMove(before, { raised: 3000, contributions: 4 })).toBe('other');
	});
});

describe('what is written about Qatom’s checkout page', () => {
	const address = 'https://checkout.m.todaq.net/checkout/abc123';
	const seen: SeenPage = {
		host: 'checkout.m.todaq.net',
		path: '/checkout/abc123',
		step: 'abc123',
		title: 'Checkout',
		headings: ['Pay 1.00'],
		buttons: [{ text: 'Continue', id: 'go', disabled: false }],
		alerts: [`Share ${address} to pay`],
		opening: `Pay 1.00 at ${address} or /checkout/abc123 now`
	};
	const fields: SeenField[] = [
		{ kind: 'input email', id: 'email-input', name: 'email', autocomplete: 'email', label: 'Email' }
	];

	it('takes every address out of text', () => {
		expect(withoutAddresses(`go to ${address}, then`)).toBe('go to (an address) then');
		expect(withoutAddresses('navigated to "/checkout/abc123"')).toBe('navigated to "(an address)"');
	});

	it('names the host, the screen and its fields, and never the address', () => {
		const text = describeCheckoutScreen(seen, fields);
		expect(text).toContain('The page was checkout.m.todaq.net, titled "Checkout".');
		expect(text).toContain('Buttons: "Continue #go".');
		expect(text).toContain(
			'Fields: input email #email-input name "email" autocomplete "email" labelled "Email".'
		);
		expect(text).not.toContain('abc123');
	});

	it('reports an error without its address or its later lines', () => {
		const error = new Error(`locator.click: Timeout\n  - navigated to "${address}"`);
		expect(quietly(error)).toBe('locator.click: Timeout');
		expect(quietly(new Error(`stuck at ${address}`))).toBe('stuck at (an address)');
	});

	it('knows a card form, and words about the wallet’s funds', () => {
		expect(asksForCard({ ...fields[0]!, autocomplete: 'cc-number' })).toBe(true);
		expect(
			asksForCard({
				kind: 'input text',
				id: null,
				name: 'cardnumber',
				autocomplete: null,
				label: null
			})
		).toBe(true);
		expect(asksForCard(fields[0]!)).toBe(false);
		expect(speaksOfFunds('Your balance is too low. Top up to continue.')).toBe(true);
		expect(speaksOfFunds('Pay 1.00 from your wallet')).toBe(false);
	});
});

describe('the endings', () => {
	const before = { raised: 0, contributions: 0 };
	const after = { raised: 1000, contributions: 1 };

	it('each says in capitals what is known about the money', () => {
		expect(nothingPaid('the screen is not known.')).toMatch(/^NOTHING WAS PAID, as far as/);
		expect(nothingPaid('x.', 'Headings: none.')).toContain('Headings: none.');
		expect(topUpNeeded('…')).toMatch(/^TOP UP NEEDED: NOTHING WAS PAID/);
		expect(ENDINGS.recorded(before, after)).toMatch(/^THE DONATION WAS PAID AND RECORDED/);
		expect(ENDINGS.recorded(before, after)).toContain('0.00 raised (0) to 1.00 raised (1)');
		expect(ENDINGS.recordedOddly(before, after)).toContain('MOVED BY THE WRONG AMOUNT');
		expect(ENDINGS.notRecorded('…')).toMatch(
			/^THE DONATION WAS PAID, BUT TEJIDO DID NOT RECORD IT within 3 minutes/
		);
		expect(ENDINGS.mayHaveBeenPaid('…')).toMatch(/^THE DONATION MAY HAVE BEEN PAID/);
		expect(ENDINGS.notKnown('the page was gone.')).toMatch(
			/^IT IS NOT KNOWN WHETHER THE DONATION WAS PAID/
		);
	});

	it('never suggests paying again', () => {
		for (const ending of [
			ENDINGS.recordedOddly(before, after),
			ENDINGS.notRecorded('…'),
			ENDINGS.mayHaveBeenPaid('…'),
			ENDINGS.notKnown('…')
		]) {
			expect(ending).toContain('Do not let another paid donation run');
		}
	});
});
