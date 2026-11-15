import { describe, expect, it } from 'vitest';
import { parseE2eConfig } from './config.ts';
import {
	describeCheckoutScreen,
	donationRunRefusal,
	ENDINGS,
	fundingFromWords,
	fundingMove,
	nothingPaid,
	paysFromWallet,
	quietly,
	sameFunding,
	smallestGift,
	thousandths,
	topUpNeeded,
	walletOption,
	withoutAddresses,
	withoutBalances,
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
const on = { ...base, E2E_PAID: 'true', E2E_PAID_DONATION: 'true' };
/** A paid run uses its own campaign in place of the fixed one (lib/run-campaign.ts). */
const run = (env: Record<string, string>, campaignId: string = 'automatic-test-run-7') => ({
	...parseE2eConfig(env),
	campaignId
});

describe('donationRunRefusal', () => {
	it('pays nothing on an ordinary run, and says so', () => {
		const refusal = donationRunRefusal(parseE2eConfig(base), null);
		expect(refusal).toEqual({ skip: expect.stringContaining('NO DONATION WAS PAID') });
	});

	it('is not switched on by the paid story’s switch alone', () => {
		expect(
			donationRunRefusal(run({ ...base, E2E_PAID: 'true' }), 'automatic-test-run-7')
		).toHaveProperty('skip');
	});

	it('pays nothing on a run that asks Qatom for no code', () => {
		const refusal = donationRunRefusal(
			run({ ...on, E2E_SKIP_SIGN_IN: 'true' }),
			'automatic-test-run-7'
		);
		expect(refusal).toEqual({ skip: expect.stringContaining('NO DONATION WAS PAID') });
	});

	it('refuses any site but the live one, even when other hosts are allowed', () => {
		const refusal = donationRunRefusal(
			run({ ...on, E2E_SITE_URL: 'http://localhost:5173', E2E_ALLOW_OTHER_HOSTS: 'true' }),
			'automatic-test-run-7'
		);
		expect(refusal).toEqual({ fail: expect.stringContaining('NOTHING WAS PAID') });
	});

	it('refuses to give outside a paid run', () => {
		const refusal = donationRunRefusal(
			run({ ...base, E2E_PAID_DONATION: 'true' }),
			'automatic-test-run-7'
		);
		expect(refusal).toEqual({ fail: expect.stringContaining('E2E_PAID=true') });
	});

	it('refuses to give to anything but the campaign this run created', () => {
		expect(donationRunRefusal(run(on), null)).toEqual({
			fail: expect.stringContaining('no campaign of its own')
		});
		expect(donationRunRefusal(run(on, 'e2e-smoke'), 'automatic-test-run-7')).toHaveProperty('fail');
	});

	it('allows only both switches, the live site, a signing run and the run’s own campaign', () => {
		expect(donationRunRefusal(run(on), 'automatic-test-run-7')).toBeNull();
	});
});

describe('the amount a test gives', () => {
	it('is the smallest on sale, whatever the order', () => {
		expect(
			smallestGift(['Give 10.00 USD-TDN', ' Give 1.00 USD-TDN ', 'Give 100.00 USD-TDN'])
		).toEqual({ button: 'Give 1.00 USD-TDN', thousandths: 1000 });
	});

	it('is nothing when no amount is on sale, or one cannot be read', () => {
		expect(smallestGift([])).toEqual({ problem: expect.stringContaining('no amount') });
		expect(smallestGift(['Give 1.00 USD-TDN', 'Give a lot'])).toHaveProperty('problem');
	});

	it('is never more than 10.00', () => {
		expect(smallestGift(['Give 10.00 USD-TDN'])).toHaveProperty('thousandths', 10_000);
		expect(smallestGift(['Give 25.00 USD-TDN'])).toEqual({
			problem: expect.stringContaining('more than the 10.00 a test may give')
		});
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

	it('takes no block as nothing raised', () => {
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
		expect(fundingMove(before, { ...before }, 1000)).toBe('unchanged');
		expect(sameFunding(before, { ...before })).toBe(true);
	});

	it('sees exactly one donation of the amount', () => {
		expect(fundingMove(before, { raised: 4000, contributions: 4 }, 1000)).toBe('recorded');
		expect(
			fundingMove({ raised: 0, contributions: 0 }, { raised: 5000, contributions: 1 }, 5000)
		).toBe('recorded');
	});

	it('never passes off anything else as this donation', () => {
		expect(fundingMove(before, { raised: 5000, contributions: 5 }, 1000)).toBe('other');
		expect(fundingMove(before, { raised: 4000, contributions: 3 }, 1000)).toBe('other');
		expect(fundingMove(before, { raised: 13_000, contributions: 4 }, 1000)).toBe('other');
		expect(fundingMove(before, { raised: 3000, contributions: 4 }, 1000)).toBe('other');
		expect(sameFunding(before, { raised: 3000, contributions: 4 })).toBe(false);
	});
});

describe('choosing how to pay on Qatom’s checkout', () => {
	it('chooses the one wallet, never the card', () => {
		expect(walletOption(['Credit card', 'e2e-contractor@e2e.m.todaq.net 12.500'])).toEqual({
			index: 1
		});
	});

	it('chooses nothing when there is no wallet, or more than one, and names no balance', () => {
		expect(walletOption(['Credit card'])).toEqual({
			problem: expect.stringContaining('no wallet')
		});
		const several = walletOption(['Credit card', 'Main 12.500', 'Savings 3.000']);
		expect(several).toEqual({ problem: expect.stringContaining('2 wallets') });
		expect(JSON.stringify(several)).not.toMatch(/12\.500|3\.000/);
		expect(several).toEqual({ problem: expect.stringContaining('"Main (an amount)"') });
	});

	it('presses only a button that pays this amount from the wallet', () => {
		expect(paysFromWallet('Pay $1.000 TDN from wallet', 1000)).toBe(true);
		expect(paysFromWallet(' Pay  $1.000 TDN  from wallet ', 1000)).toBe(true);
		// The card's button.
		expect(paysFromWallet('Pay $1.000 TDN', 1000)).toBe(false);
		// Another amount.
		expect(paysFromWallet('Pay $10.000 TDN from wallet', 1000)).toBe(false);
		expect(paysFromWallet('Pay $11.000 TDN from wallet', 1000)).toBe(false);
		expect(paysFromWallet('Pay $1.000 or $2.000 from wallet', 1000)).toBe(false);
		expect(paysFromWallet('Completing purchase…', 1000)).toBe(false);
	});
});

describe('what is written about Qatom’s checkout page', () => {
	const address = 'https://checkout.m.todaq.net/checkout/abc123';
	const seen: SeenPage = {
		host: 'checkout.m.todaq.net',
		path: '/checkout/abc123',
		step: 'abc123',
		title: 'Checkout',
		headings: ['Verify & pay'],
		buttons: [{ text: 'Pay $1.000 TDN from wallet', id: null, disabled: false }],
		alerts: [`Main holds 0.250; this purchase needs $1.000 TDN. See ${address}`],
		opening: `Pay at ${address} or /checkout/abc123 now. Balance 12.500`
	};
	const fields: SeenField[] = [
		{
			kind: 'input email',
			id: 'checkout-entry-email',
			name: null,
			autocomplete: 'email',
			label: 'Email'
		}
	];

	it('takes every address out of text', () => {
		expect(withoutAddresses(`go to ${address}, then`)).toBe('go to (an address) then');
		expect(withoutAddresses('navigated to "/checkout/abc123"')).toBe('navigated to "(an address)"');
	});

	it('takes balances and prices out of text, and leaves Tejido’s amounts', () => {
		expect(withoutBalances('Main holds 0.250; needs $1.000 TDN')).toBe(
			'Main holds (an amount); needs (an amount) TDN'
		);
		expect(withoutBalances('1.00 USD-TDN raised')).toBe('1.00 USD-TDN raised');
	});

	it('names the host, the screen and its fields, and never the address or a balance', () => {
		const text = describeCheckoutScreen(seen, fields);
		expect(text).toContain('The page was checkout.m.todaq.net, titled "Checkout".');
		expect(text).toContain('Buttons: "Pay (an amount) TDN from wallet".');
		expect(text).toContain(
			'Fields: input email #checkout-entry-email autocomplete "email" labelled "Email".'
		);
		expect(text).not.toContain('abc123');
		expect(text).not.toMatch(/0\.250|12\.500|1\.000/);
	});

	it('reports an error without its address or its later lines', () => {
		const error = new Error(`locator.click: Timeout\n  - navigated to "${address}"`);
		expect(quietly(error)).toBe('locator.click: Timeout');
		expect(quietly(new Error(`stuck at ${address}`))).toBe('stuck at (an address)');
	});
});

describe('the endings', () => {
	const before = { raised: 0, contributions: 0 };
	const after = { raised: 1000, contributions: 1 };

	it('each says in capitals what is known about the money', () => {
		expect(nothingPaid('the screen is not known.')).toMatch(/^NOTHING WAS PAID, as far as/);
		expect(nothingPaid('x.', 'Headings: none.')).toContain('Headings: none.');
		expect(topUpNeeded(1000)).toMatch(/^TOP UP NEEDED: NOTHING WAS PAID/);
		expect(ENDINGS.recorded(1000, before, after)).toMatch(/^THE DONATION WAS PAID AND RECORDED/);
		expect(ENDINGS.recorded(1000, before, after)).toContain('0.00 raised (0) to 1.00 raised (1)');
		expect(ENDINGS.recordedOddly(1000, before, after)).toContain('MOVED BY THE WRONG AMOUNT');
		expect(ENDINGS.notRecorded(1000)).toMatch(
			/^THE DONATION WAS PAID, BUT TEJIDO DID NOT RECORD IT within 3 minutes/
		);
		expect(ENDINGS.mayHaveBeenPaid('…')).toMatch(/^THE DONATION MAY HAVE BEEN PAID/);
		expect(ENDINGS.notKnown(1000, 'the page was gone.')).toMatch(
			/^IT IS NOT KNOWN WHETHER THE DONATION WAS PAID/
		);
	});

	it('say apart whether the donation was then taken back out', () => {
		expect(ENDINGS.undone(1000, before)).toMatch(/^THE TEST DONATION WAS TAKEN BACK OUT/);
		expect(ENDINGS.notUndone(1000, before, after)).toMatch(
			/^THE DONATION WAS PAID AND RECORDED, BUT IT WAS NOT TAKEN BACK OUT within 6 minutes/
		);
		expect(ENDINGS.undoUnread(1000)).toContain('IS NOT KNOWN');
	});

	it('never suggests paying again', () => {
		for (const ending of [
			ENDINGS.recordedOddly(1000, before, after),
			ENDINGS.notRecorded(1000),
			ENDINGS.mayHaveBeenPaid('…'),
			ENDINGS.notKnown(1000, '…')
		]) {
			expect(ending).toContain('Do not let another paid donation run');
		}
	});
});
