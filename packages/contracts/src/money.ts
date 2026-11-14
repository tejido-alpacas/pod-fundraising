import { z } from 'zod';

/**
 * Money.
 *
 * Every amount in our records is a whole number of Qatom's smallest unit of USD-TDN, the unit
 * Qatom's transfer call takes. Qatom quotes USD-TDN to three decimal places, so we treat one
 * unit as 0.001: a 0.10 deposit is 100 and a 1.00 deposit is 1000. Whole numbers keep sums exact.
 *
 * NOT YET CONFIRMED AGAINST A LIVE LEDGER. Qatom's API document says prices and transfers are
 * "in the smallest unit" and shows amounts to three decimals, but never states the scale.
 * Buy one 0.10 item on staging and read its ledger amount. If it is not 100, change
 * AMOUNT_UNITS_PER_USD_TDN here and nothing else: the deposit amounts below follow from it.
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
