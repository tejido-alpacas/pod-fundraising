/**
 * The words and the sums of the paid donation test (specs/paid-donation.spec.ts): when it may
 * run at all, how the campaign's Funding block is read, whether a donation shows in it, and how
 * every ending is worded. Nothing here opens a page or reaches the network.
 *
 * A DONATION IS NOT A DEPOSIT: nothing returns it. Each one costs its amount for good, out of a
 * test person's own Qatom wallet and into Tejido's merchant account. So every ending says, in
 * capitals, what is known about the money: nothing was paid; it was paid and recorded; it was
 * paid but Tejido did not record it in the time allowed; it may have been paid; or it is not
 * known.
 */
import { PRODUCTION_SITE_URL, type E2eConfig } from './config.ts';
import { describeSeenPage, tidy, type SeenPage } from './stuck-page.ts';

/** The one amount a test may give: the smallest donation item, as the Give page words it. */
export const DONATION = '1.00';
/** The same amount in thousandths of a USD-TDN, which is how the sums here are done. */
export const DONATION_THOUSANDTHS = 1000;
/** How long Tejido is given to show the donation on the campaign's page after the one press. */
export const RECORD_WAIT_MS = 180_000;
export const RECORD_WAIT_WORDS = '3 minutes';
/**
 * Who a campaign must name as its organiser before a test gives to it: the name the suite's own
 * campaigns carry (lib/run-campaign.ts). A campaign that does not say so is never given to, so
 * test money never lands in a real campaign's public total.
 */
export const TEST_ORGANISER = 'Tejido automated tests';

const SWITCH = 'E2E_PAID_DONATION';
const LOOK_FIRST =
	'Do not let another paid donation run before a person has looked at the test donor’s Qatom ' +
	'wallet and at the campaign’s page.';

type DonationRun = Pick<E2eConfig, 'paidDonation' | 'donationCampaignId' | 'siteUrl' | 'signIn'>;

/**
 * Why this run pays no donation, or null when it may. `skip` is the ordinary case (the switch is
 * off, which is every run today); `fail` is a run that was switched on wrongly.
 */
export function donationRunRefusal(cfg: DonationRun): { skip: string } | { fail: string } | null {
	if (!cfg.paidDonation) {
		return {
			skip:
				`Not run: ${SWITCH} is not "true", so NO DONATION WAS PAID and no checkout was made. ` +
				'Nothing sets it: a paid donation test is not allowed until the owner says so.'
		};
	}
	if (!cfg.signIn) {
		return {
			skip:
				'NO DONATION WAS PAID: this run asks Qatom for no sign-in code, and paying on Qatom’s ' +
				'checkout page needs one.'
		};
	}
	if (cfg.siteUrl !== PRODUCTION_SITE_URL) {
		return {
			fail:
				`NOTHING WAS PAID. ${SWITCH}=true is only allowed against ${PRODUCTION_SITE_URL}: a ` +
				'donation is real money wherever it is paid.'
		};
	}
	if (cfg.donationCampaignId === null) {
		return {
			fail:
				`NOTHING WAS PAID. ${SWITCH}=true was set without E2E_DONATION_CAMPAIGN_ID, so there is ` +
				'no campaign this test may give to. It never picks one from the site’s lists.'
		};
	}
	return null;
}

/** What a campaign's Funding block says: the total, in thousandths, and how many gifts make it. */
export interface Funding {
	raised: number;
	contributions: number;
}

/** "1,234.50" as 1234500 thousandths. Null for anything that is not such a number. */
export function thousandths(written: string): number | null {
	const match = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2,3})$/.exec(written.trim());
	if (!match?.[1] || !match[2]) return null;
	return Number(match[1].replace(/,/g, '')) * 1000 + Number(match[2].padEnd(3, '0'));
}

/**
 * Reads the Funding block's own words ("1.00 USD-TDN raised … 1 contribution …"). The campaign
 * page draws no Funding block until a first donation is recorded, so `null` (no block) is no
 * donation yet: nothing raised, from no contributions. Words it cannot read are not a zero:
 * they throw.
 */
export function fundingFromWords(words: string | null): Funding {
	if (words === null) return { raised: 0, contributions: 0 };
	const text = words.replace(/\s+/g, ' ');
	const raised = /([\d,]+\.\d{2,3}) USD-TDN raised/.exec(text)?.[1];
	const contributions = /([\d,]+) contributions?\b/.exec(text)?.[1];
	const amount = raised === undefined ? null : thousandths(raised);
	if (amount === null || contributions === undefined) {
		throw new Error(
			`The campaign’s Funding block could not be read. It says: "${tidy(text, 200)}".`
		);
	}
	return { raised: amount, contributions: Number(contributions.replace(/,/g, '')) };
}

/** "1.00" or "0.125": thousandths as the pages write an amount. */
export function written(amount: number): string {
	const sign = amount < 0 ? '-' : '';
	const whole = Math.trunc(Math.abs(amount) / 1000);
	const fraction = String(Math.abs(amount) % 1000)
		.padStart(3, '0')
		.replace(/0$/, '');
	return `${sign}${whole}.${fraction}`;
}

/**
 * What happened to the campaign's total between two reads: nothing; exactly this one donation
 * (one more contribution, and its amount more); or something else, which is never passed off as
 * either.
 */
export function fundingMove(
	before: Funding,
	after: Funding,
	amount: number = DONATION_THOUSANDTHS
): 'unchanged' | 'recorded' | 'other' {
	const raised = after.raised - before.raised;
	const contributions = after.contributions - before.contributions;
	if (raised === 0 && contributions === 0) return 'unchanged';
	return raised === amount && contributions === 1 ? 'recorded' : 'other';
}

/**
 * Takes every web address out of text read from, or thrown about, Qatom's checkout page. The
 * end of a checkout's address is what lets its holder pay it, so no address from there is ever
 * written: only the host is named, by the code that knows it.
 */
export function withoutAddresses(text: string): string {
	return text
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, '(an address)')
		.replace(/\/checkout\/[^\s"'<>)]*/gi, '(an address)');
}

/** An error's first line, with no address in it, short enough for a log. */
export function quietly(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return tidy(withoutAddresses(message.split('\n')[0] ?? ''), 300);
}

/** One field of a form, as a person could tell it apart. Never what is typed in it. */
export interface SeenField {
	kind: string;
	id: string | null;
	name: string | null;
	autocomplete: string | null;
	label: string | null;
}

/**
 * What one screen of Qatom's checkout showed, for the run's log: its title, headings, buttons,
 * notices, first words and the fields it asks for. THE PAGE'S ADDRESS IS LEFT OUT, whatever was
 * read: only its host is named. No field's value is ever read.
 */
export function describeCheckoutScreen(seen: SeenPage, fields: readonly SeenField[]): string {
	const page = describeSeenPage({
		...seen,
		path: '',
		step: null,
		title: withoutAddresses(seen.title),
		headings: seen.headings.map(withoutAddresses),
		buttons: seen.buttons.map((button) => ({ ...button, text: withoutAddresses(button.text) })),
		alerts: seen.alerts.map(withoutAddresses),
		opening: withoutAddresses(seen.opening)
	});
	const asked = fields.map((field) => {
		const parts = [
			field.kind,
			field.id ? `#${tidy(field.id)}` : null,
			field.name ? `name "${tidy(field.name)}"` : null,
			field.autocomplete ? `autocomplete "${tidy(field.autocomplete)}"` : null,
			field.label ? `labelled "${tidy(withoutAddresses(field.label))}"` : null
		];
		return parts.filter((part) => part !== null).join(' ');
	});
	return `${page}\nFields: ${asked.length > 0 ? asked.join(' | ') : 'none'}.`;
}

/** True when a field asks for a payment card. Such a screen is never typed into or pressed on. */
export function asksForCard(field: SeenField): boolean {
	return (
		/^cc-/i.test(field.autocomplete ?? '') ||
		/card.?number|cardnumber|\bcvc\b|\bcvv\b/i.test(
			`${field.id ?? ''} ${field.name ?? ''} ${field.label ?? ''}`
		)
	);
}

/** True when a screen's words speak of the wallet being short, or of adding funds to it. */
export function speaksOfFunds(words: string): boolean {
	return /top.?up|add funds|insufficient|not enough|too low|short of funds/i.test(words);
}

/** Every ending before the pay button was pressed. `shown` is what the screen showed, or ''. */
export function nothingPaid(why: string, shown: string = ''): string {
	return (
		`NOTHING WAS PAID, as far as the page shows: ${why} The pay button was never pressed, and ` +
		'no card was used.' +
		(shown ? `\nWhat Qatom’s checkout page showed:\n${shown}` : '')
	);
}

/** The wallet is short: a job for a person, not a fault. A notice, not a red failure. */
export function topUpNeeded(shown: string): string {
	return (
		'TOP UP NEEDED: NOTHING WAS PAID. Qatom’s checkout page speaks of the wallet’s funds or asks ' +
		`for a card, and this test never uses a card. Add funds to the test donor’s Qatom wallet (a ` +
		`donation costs ${DONATION}, and it is never returned).\nWhat Qatom’s checkout page showed:\n${shown}`
	);
}

/** After the one press. */
export const ENDINGS = {
	recorded: (before: Funding, after: Funding) =>
		`THE DONATION WAS PAID AND RECORDED: ${DONATION} USD-TDN left the test donor’s wallet for ` +
		`good, and the campaign’s Funding block went from ${written(before.raised)} raised ` +
		`(${before.contributions}) to ${written(after.raised)} raised (${after.contributions}).`,
	recordedOddly: (before: Funding, after: Funding) =>
		`THE DONATION WAS PAID, AND THE CAMPAIGN’S TOTAL MOVED BY THE WRONG AMOUNT. One donation of ` +
		`${DONATION} should add ${DONATION} and one contribution. The Funding block went from ` +
		`${written(before.raised)} raised (${before.contributions}) to ${written(after.raised)} ` +
		`raised (${after.contributions}). Either Tejido counted it more than once, or someone else ` +
		`gave to the test campaign in the same minutes. ${LOOK_FIRST}`,
	notRecorded: (shown: string) =>
		`THE DONATION WAS PAID, BUT TEJIDO DID NOT RECORD IT within ${RECORD_WAIT_WORDS}. Qatom’s ` +
		`page says it was paid, and the campaign’s Funding block did not change. ${DONATION} USD-TDN ` +
		'left the test donor’s wallet. Either Qatom has not called Tejido yet, or Tejido refused or ' +
		`lost the call. Do not pay again to find out. ${LOOK_FIRST}` +
		`\nWhat Qatom’s page showed after the press:\n${shown}`,
	mayHaveBeenPaid: (shown: string) =>
		`THE DONATION MAY HAVE BEEN PAID. The pay button was pressed once. Qatom’s page did not say ` +
		`it was paid, and the campaign’s Funding block did not change within ${RECORD_WAIT_WORDS}. ` +
		`${LOOK_FIRST}\nWhat Qatom’s page showed after the press:\n${shown}`,
	notKnown: (why: string) =>
		`IT IS NOT KNOWN WHETHER THE DONATION WAS PAID. The pay button was pressed once, and then ` +
		`${why} ${DONATION} USD-TDN may have left the test donor’s wallet. ${LOOK_FIRST}`
};
