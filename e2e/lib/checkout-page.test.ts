import { describe, expect, it } from 'vitest';
import { checkoutInWords, readCheckoutWords, writesAmount } from './checkout-page.ts';

describe('writesAmount', () => {
	it('finds the amount beside its unit, either way round', () => {
		expect(writesAmount('Total 1.00 USD-TDN', '1.00')).toBe(true);
		expect(writesAmount('Total: 1 USD-TDN', '1.00')).toBe(true);
		expect(writesAmount('USD-TDN 25.00', '25.00')).toBe(true);
		expect(writesAmount('Pay 10,00 TDN now', '10.00')).toBe(true);
		expect(writesAmount('Pay $100.00', '100.00')).toBe(true);
		expect(writesAmount('1.000 usd-tdn', '1.00')).toBe(true);
		// As Qatom's checkout is said to write a price: three decimals after a dollar sign.
		expect(writesAmount('TOTAL $1.000 TJD', '1.00')).toBe(true);
		expect(writesAmount('TOTAL $10.000 TJD', '1.00')).toBe(false);
	});

	it('finds a grouped thousand', () => {
		expect(writesAmount('1,000.00 USD-TDN', '1000.00')).toBe(true);
		expect(writesAmount('1000 USD-TDN', '1000.00')).toBe(true);
	});

	it('does not find the amount inside another number', () => {
		expect(writesAmount('11.00 USD-TDN', '1.00')).toBe(false);
		expect(writesAmount('21.00 USD-TDN', '1.00')).toBe(false);
		expect(writesAmount('1.50 USD-TDN', '1.00')).toBe(false);
		expect(writesAmount('10.00 USD-TDN', '1.00')).toBe(false);
		expect(writesAmount('100.00 USD-TDN', '10.00')).toBe(false);
		expect(writesAmount('0.10 USD-TDN', '10.00')).toBe(false);
		expect(writesAmount('$10.00', '1.00')).toBe(false);
	});

	it('does not find a number that stands apart from any unit', () => {
		expect(writesAmount('Step 1 of 2', '1.00')).toBe(false);
		expect(writesAmount('1 item in your order. Pay in USD-TDN.', '1.00')).toBe(false);
	});

	it('answers false for an amount that is not a whole number', () => {
		expect(writesAmount('0.10 USD-TDN', '0.10')).toBe(false);
		expect(writesAmount('USD-TDN', '')).toBe(false);
	});
});

describe('readCheckoutWords', () => {
	const offered = ['1.00', '10.00', '25.00', '100.00'];

	it('reads a page that is for the amount pressed', () => {
		expect(
			readCheckoutWords('Tejido donation 1\nTotal 1.00 USD-TDN\nPay', '1.00', offered)
		).toEqual({ pressedShown: true, othersShown: [], namesUnit: true, namesTejido: true });
	});

	it('reads a page that is for another amount', () => {
		expect(readCheckoutWords('Total 10.00 USD-TDN', '1.00', offered)).toEqual({
			pressedShown: false,
			othersShown: ['10.00'],
			namesUnit: true,
			namesTejido: false
		});
	});

	it('reads a page that names no amount it knows', () => {
		expect(readCheckoutWords('Sign in to continue', '1.00', offered)).toEqual({
			pressedShown: false,
			othersShown: [],
			namesUnit: false,
			namesTejido: false
		});
	});
});

describe('checkoutInWords', () => {
	it('says plainly that the page is for the amount pressed', () => {
		const words = checkoutInWords(
			{ pressedShown: true, othersShown: [], namesUnit: true, namesTejido: true },
			'1.00',
			['Checkout'],
			['Pay']
		);
		expect(words).toContain('Pressed 1.00 USD-TDN.');
		expect(words).toContain('writes that amount beside its unit');
		expect(words).toContain('none of the other amounts');
		expect(words).toContain('It names Tejido.');
		expect(words).toContain('Headings: "Checkout".');
		expect(words).toContain('Buttons (none was pressed): "Pay".');
	});

	it('says loudly when the page shows another amount and not the one pressed', () => {
		const words = checkoutInWords(
			{ pressedShown: false, othersShown: ['10.00'], namesUnit: true, namesTejido: false },
			'1.00',
			[],
			[]
		);
		expect(words).toContain('DOES NOT WRITE THE PRESSED AMOUNT');
		expect(words).toContain('OTHER AMOUNTS THE GIVE PAGE OFFERS: 10.00');
		expect(words).toContain('Headings: none.');
	});

	it('says so when the page names no unit this check knows', () => {
		const words = checkoutInWords(
			{ pressedShown: false, othersShown: [], namesUnit: false, namesTejido: false },
			'1.00',
			[],
			[]
		);
		expect(words).toContain('does not write that amount beside a unit this check knows');
	});
});
