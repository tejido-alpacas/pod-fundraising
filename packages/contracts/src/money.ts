import { z } from 'zod';

/**
 * Money.
 *
 * Every amount in our records is a whole number of thousandths of USD-TDN. This is TEJIDO'S
 * OWN unit: a 0.10 deposit is 100 and a 1.00 deposit is 1000. Whole numbers keep sums exact.
 *
 * IT IS NOT QATOM'S UNIT. Qatom's API uses decimal USD-TDN everywhere (prices, transfers and
 * ledger amounts): there a 0.10 deposit is 0.1 and 1.00 is 1. Amounts are converted in exactly
 * one place, `packages/qatom/src/account/amounts.ts`, on their way to and from Qatom.
 *
 * DO NOT CHANGE AMOUNT_UNITS_PER_USD_TDN to make our numbers agree with Qatom's. Everything
 * stored is already in thousandths, and the conversion divides and multiplies by this number:
 * changing it would misread every stored amount and send transfers of the wrong size.
 */
export const AMOUNT_UNITS_PER_USD_TDN = 1000;

export const amountSchema = z.number().int().nonnegative();
export type Amount = z.infer<typeof amountSchema>;

/** The deposit paid with each purchase: 0.10 for a work log, 1.00 for a milestone hit. */
export const DEPOSIT_AMOUNT = {
	log_work: AMOUNT_UNITS_PER_USD_TDN / 10,
	milestone_hit: AMOUNT_UNITS_PER_USD_TDN
} as const satisfies Record<'log_work' | 'milestone_hit', Amount>;

/** Formats an amount for people: 100 becomes "0.10", 1000 becomes "1.00", 125 becomes "0.125". */
export function formatAmount(amount: Amount): string {
	const digits = Math.round(Math.log10(AMOUNT_UNITS_PER_USD_TDN));
	const whole = Math.trunc(amount / AMOUNT_UNITS_PER_USD_TDN);
	const fraction = String(amount % AMOUNT_UNITS_PER_USD_TDN).padStart(digits, '0');
	// Show two decimals, and a third only when it carries a digit.
	const shown = digits > 2 ? fraction.replace(/0+$/, '').padEnd(2, '0') : fraction.padEnd(2, '0');
	return `${whole}.${shown}`;
}
