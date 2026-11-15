/**
 * THE ONE PLACE that converts an amount between Tejido's unit and Qatom's.
 *
 * Tejido counts money in whole thousandths of USD-TDN (AMOUNT_UNITS_PER_USD_TDN in
 * @tejido/contracts): 1.00 is `1000`, 0.10 is `100`.
 *
 * Qatom's API uses decimal USD-TDN everywhere: prices, transfer amounts and ledger amounts.
 * There 1.00 is `1` and 0.10 is `0.1`. Its API document says "in the smallest unit"; the
 * server's behaviour wins. Qatom does no scaling and no validation of a transfer's amount, so
 * an amount sent in our unit would be sent as 1000 times too much.
 *
 * Every amount that crosses to or from Qatom in this package goes through these two functions.
 * Nothing outside this package converts: callers give and get Tejido's unit.
 */
import { AMOUNT_UNITS_PER_USD_TDN } from '@tejido/contracts';

/**
 * Tejido's whole thousandths as the decimal USD-TDN Qatom takes: `1000` becomes `1`, `100`
 * becomes `0.1`, `1100` becomes `1.1`. At most three decimals, because the input is whole.
 *
 * Throws RangeError for anything but a positive whole number: nothing is rounded on the way out.
 */
export function toQatomAmount(units: number): number {
	if (!Number.isSafeInteger(units) || units <= 0) {
		throw new RangeError("the amount must be a positive whole number of Tejido's thousandths");
	}
	return units / AMOUNT_UNITS_PER_USD_TDN;
}

/**
 * Qatom's decimal USD-TDN as Tejido's whole thousandths: `0.1` becomes `100`, `1` becomes
 * `1000`, `1.1` becomes `1100`. Rounded to the nearest whole thousandth, because a decimal
 * such as 0.3 may arrive as 0.30000000000000004.
 *
 * Null when the value is not a finite number, or is too large to hold exactly. Null is a
 * refusal: the caller must not use the amount.
 */
export function fromQatomAmount(decimal: unknown): number | null {
	if (typeof decimal !== 'number' || !Number.isFinite(decimal)) return null;
	const units = Math.round(decimal * AMOUNT_UNITS_PER_USD_TDN);
	// Math.round(-0.0001 * 1000) is -0; store a plain 0.
	return Number.isSafeInteger(units) ? units + 0 : null;
}
