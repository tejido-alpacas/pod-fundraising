/**
 * Reading Qatom's checkout page after a donor pressed an amount, WITHOUT pressing or typing
 * anything on it: is the page for the amount that was pressed?
 *
 * Qatom's wording is not known from this repository, so nothing here expects particular
 * words. It looks for the amount as a number beside its unit, and says what it found.
 *
 * The page's address can be paid by whoever holds it. It is never returned, printed or kept:
 * only words a person could read on the page are, with anything long enough to be a value
 * taken out, and any line that repeats the last part of the address dropped.
 */
import type { Page } from '@playwright/test';
import { tidy } from './stuck-page.ts';

const UNITS = '(?:USD-TDN|TDN|USD)';

/**
 * True when `text` writes this whole amount beside its unit, either way round: "1.00 USD-TDN",
 * "USD-TDN 1", "1,00 TDN", "$1.00". The number must stand alone: "1.00" is not found in
 * "11.00", "21.00" or "1.50".
 */
export function writesAmount(text: string, amount: string): boolean {
	const value = Number(amount);
	if (!Number.isInteger(value) || value <= 0) return false;
	// The whole number, with its thousands grouped or not, and nothing or only zeros after it.
	const digits = String(value);
	const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '[,.  ]?');
	const number = `(?<![\\d.,])${grouped}(?:[.,]0+)?(?![\\d]|[.,]\\d)`;
	return (
		new RegExp(`${number}\\s*${UNITS}`, 'i').test(text) ||
		new RegExp(`(?:${UNITS}|\\$)\\s*${number}`, 'i').test(text)
	);
}

export interface CheckoutReading {
	/** The amount that was pressed is written beside its unit. */
	pressedShown: boolean;
	/** Other amounts the Give page offered that are written beside the unit here. */
	othersShown: string[];
	/** The page names the unit at all. */
	namesUnit: boolean;
	/** The page names Tejido. */
	namesTejido: boolean;
}

/** What the words of a checkout page say about the amount pressed. Reads its arguments only. */
export function readCheckoutWords(
	text: string,
	pressed: string,
	offered: readonly string[]
): CheckoutReading {
	return {
		pressedShown: writesAmount(text, pressed),
		othersShown: offered.filter(
			(amount) => Number(amount) !== Number(pressed) && writesAmount(text, amount)
		),
		namesUnit: new RegExp(UNITS, 'i').test(text),
		namesTejido: /tejido/i.test(text)
	};
}

/** The reading in plain words, for the run's report. */
export function checkoutInWords(
	reading: CheckoutReading,
	pressed: string,
	headings: readonly string[],
	buttons: readonly string[]
): string {
	const list = (items: readonly string[]) =>
		items.length === 0 ? 'none' : items.map((item) => `"${item}"`).join(', ');
	return [
		`Pressed ${pressed} USD-TDN.`,
		reading.pressedShown
			? 'Qatom’s checkout page writes that amount beside its unit.'
			: reading.namesUnit
				? 'QATOM’S CHECKOUT PAGE NAMES THE UNIT BUT DOES NOT WRITE THE PRESSED AMOUNT BESIDE IT.'
				: 'Qatom’s checkout page does not write that amount beside a unit this check knows (USD-TDN, TDN, USD or $).',
		reading.othersShown.length > 0
			? `IT ALSO WRITES OTHER AMOUNTS THE GIVE PAGE OFFERS: ${reading.othersShown.join(', ')}.`
			: 'It writes none of the other amounts the Give page offers.',
		reading.namesTejido ? 'It names Tejido.' : 'It does not name Tejido.',
		`Headings: ${list(headings)}.`,
		`Buttons (none was pressed): ${list(buttons)}.`
	].join(' ');
}

const QUICK = { timeout: 2_000 };
const MOST = 6;

/**
 * Reads the checkout page the browser is on and says, in words, what it shows about the
 * amount. Presses nothing and types nothing. Never throws and never repeats the address: when
 * the page cannot be read it says so, without the reason's own words (they can hold an address).
 */
export async function describeCheckoutPage(
	page: Page,
	pressed: string,
	offered: readonly string[]
): Promise<string> {
	try {
		// The last part of the address is what lets its holder pay. Kept here only to drop any
		// line of the page that repeats it.
		const secret = new URL(page.url()).pathname.split('/').pop() ?? '';
		const safe = (texts: string[]) =>
			texts
				.filter((text) => secret === '' || !text.includes(secret))
				.map((text) => tidy(text))
				.filter((text) => text !== '')
				.slice(0, MOST);

		// The page may draw its words after it loads: wait a while for the unit or any words.
		const body = page.locator('body');
		let text = '';
		const deadline = Date.now() + 20_000;
		for (;;) {
			text = await body.innerText(QUICK).catch(() => '');
			if (new RegExp(UNITS, 'i').test(text) || Date.now() >= deadline) break;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		if (text.trim() === '') {
			return `Pressed ${pressed} USD-TDN. Qatom’s checkout page showed no words within 20 seconds, so what it is for could not be read.`;
		}

		const headings: string[] = [];
		for (const heading of await page.getByRole('heading').all()) {
			if (await heading.isVisible()) headings.push(await heading.innerText(QUICK));
		}
		const buttons: string[] = [];
		for (const button of await page.getByRole('button').all()) {
			if (await button.isVisible()) buttons.push(await button.innerText(QUICK));
		}
		return checkoutInWords(
			readCheckoutWords(text, pressed, offered),
			pressed,
			safe(headings),
			safe(buttons)
		);
	} catch {
		return `Pressed ${pressed} USD-TDN. Qatom’s checkout page could not be read.`;
	}
}
