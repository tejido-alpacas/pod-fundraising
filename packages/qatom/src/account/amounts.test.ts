// The one conversion between Tejido's thousandths and Qatom's decimal USD-TDN. No network.
import { AMOUNT_UNITS_PER_USD_TDN, DEPOSIT_AMOUNT } from '@tejido/contracts';
import { describe, expect, it } from 'vitest';
import { fromQatomAmount, toQatomAmount } from './amounts.ts';

describe('an amount on its way to Qatom', () => {
	it.each([
		[100, 0.1, '0.1'],
		[1000, 1, '1'],
		[1100, 1.1, '1.1'],
		[1, 0.001, '0.001'],
		[1234, 1.234, '1.234'],
		[300, 0.3, '0.3'],
		[700, 0.7, '0.7'],
		[123456789, 123456.789, '123456.789']
	])('turns our %s into %s, written %s in JSON', (units, decimal, written) => {
		expect(toQatomAmount(units)).toBe(decimal);
		expect(JSON.stringify(toQatomAmount(units))).toBe(written);
	});

	it('sends the two deposits as 0.1 and 1, never as 100 and 1000', () => {
		expect(toQatomAmount(DEPOSIT_AMOUNT.log_work)).toBe(0.1);
		expect(toQatomAmount(DEPOSIT_AMOUNT.milestone_hit)).toBe(1);
	});

	it('never writes more than three decimals, for any amount up to 100.000', () => {
		for (let units = 1; units <= 100_000; units += 1) {
			const written = JSON.stringify(toQatomAmount(units));
			if (!/^[0-9]+(\.[0-9]{1,3})?$/.test(written))
				throw new Error(`${units} is written ${written}`);
		}
	});

	it.each([0, -100, 0.1, 100.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
		'refuses %s: nothing is rounded on the way out',
		(units) => {
			expect(() => toQatomAmount(units)).toThrow(RangeError);
		}
	);
});

describe('an amount on its way from Qatom', () => {
	it.each([
		[0.1, 100],
		[1, 1000],
		[1.1, 1100],
		[0.001, 1],
		[1.234, 1234],
		[2500, 2500000],
		[0, 0]
	])('turns %s into our %s', (decimal, units) => {
		expect(fromQatomAmount(decimal)).toBe(units);
	});

	it('rounds a value that does not convert cleanly to the nearest whole thousandth', () => {
		// Not exactly a number of thousandths in binary: 0.1 + 0.2, and 1.1 * 3.
		expect(fromQatomAmount(0.1 + 0.2)).toBe(300);
		expect(fromQatomAmount(1.1 * 3)).toBe(3300);
		expect(fromQatomAmount(0.07 * 100)).toBe(7000);
		// Finer than a thousandth: the nearest one.
		expect(fromQatomAmount(0.1234)).toBe(123);
		expect(fromQatomAmount(0.1236)).toBe(124);
		expect(fromQatomAmount(-0.0001)).toBe(0);
		expect(Object.is(fromQatomAmount(-0.0001), 0)).toBe(true);
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		1e300,
		'0.1',
		null,
		undefined,
		{}
	])('refuses %s', (value) => {
		expect(fromQatomAmount(value)).toBeNull();
	});

	it('gives back every whole amount it was given: there and back changes nothing', () => {
		for (let units = 1; units <= 100_000; units += 1) {
			if (fromQatomAmount(toQatomAmount(units)) !== units) throw new Error(`${units} changed`);
		}
	});

	it('follows the one constant in @tejido/contracts', () => {
		expect(AMOUNT_UNITS_PER_USD_TDN).toBe(1000);
		expect(fromQatomAmount(1)).toBe(AMOUNT_UNITS_PER_USD_TDN);
	});
});
