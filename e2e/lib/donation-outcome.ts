/**
 * The words and the sums of the paid donation test (specs/paid-donation.spec.ts): when it may
 * run at all, which amount it gives, how the campaign's Funding block is read, whether a
 * donation shows in it, and how every ending is worded. Nothing here opens a page or reaches
 * the network.
 *
 * The donation is real money: it leaves a test person's own Qatom wallet for Tejido's merchant
 * account. NOTHING SENDS IT BACK BY ITSELF: the owner returns test money by hand (CLAUDE.md,
 * "Never move money to test something"), and the donation stays in the test campaign's total
 * until the cleanup removes the campaign. So every ending says, in capitals, what is known
 * about the money: nothing was paid; it was paid and recorded; it was paid but Tejido did not
 * record it in the time allowed; it may have been paid; or it is not known.
 */
import { PRODUCTION_SITE_URL, type E2eConfig } from './config.ts';
import { describeSeenPage, tidy, type SeenPage } from './stuck-page.ts';

/** How long Tejido is given to show the donation on the campaign's page after the one press. */
export const RECORD_WAIT_MS = 180_000;
export const RECORD_WAIT_WORDS = '3 minutes';
/**
 * The most a test may ever give, in thousandths of a USD-TDN: 10.00. The smallest amount on
 * sale is refused if it is more: a test's donation is not sent back by itself.
 */
export const MOST_THOUSANDTHS = 10_000;
/**
 * Who a campaign must name as its organiser before a test gives to it: the name the suite's own
 * campaigns carry (lib/run-campaign.ts). A campaign that does not say so is never given to, so
 * test money never lands in a real campaign's public total.
 */
export const TEST_ORGANISER = 'Tejido automated tests';

const SWITCH = 'E2E_PAID_DONATION';
const LOOK_FIRST =
	'Do not let another paid donation run before a person has looked at the test contractor’s ' +
	'Qatom wallet and at the campaign’s page.';

type DonationRun = Pick<E2eConfig, 'paidDonation' | 'paid' | 'siteUrl' | 'signIn' | 'campaignId'>;

/**
 * Why this run pays no donation, or null when it may. `skip` is the ordinary case (the switch is
 * off); `fail` is a run that was switched on wrongly. `runCampaignId` is the campaign this run
 * created for itself, or null when it created none: a donation is only ever given to that one.
 */
export function donationRunRefusal(
	cfg: DonationRun,
	runCampaignId: string | null
): { skip: string } | { fail: string } | null {
	if (!cfg.paidDonation) {
		return {
			skip:
				`Not run: ${SWITCH} is not "true", so NO DONATION WAS PAID and no checkout was made. ` +
				'Only the workflow may set it, on a run that tells the paid story.'
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
	if (!cfg.paid) {
		return {
			fail:
				`NOTHING WAS PAID. ${SWITCH}=true was set without E2E_PAID=true. A donation is part of ` +
				'the paid story and is given only to the campaign a paid run creates for itself.'
		};
	}
	if (runCampaignId === null || runCampaignId !== cfg.campaignId) {
		return {
			fail:
				'NOTHING WAS PAID. This run has no campaign of its own (specs/create-campaign.spec.ts ' +
				'did not create one), and a test donation is never given to any other campaign.'
		};
	}
	return null;
}

/** "1,234.50" as 1234500 thousandths. Null for anything that is not such a number. */
export function thousandths(text: string): number | null {
	const match = /^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2,3})$/.exec(text.trim());
	if (!match?.[1] || !match[2]) return null;
	return Number(match[1].replace(/,/g, '')) * 1000 + Number(match[2].padEnd(3, '0'));
}

/** "1.00" or "0.125": thousandths as Tejido's pages write an amount. */
export function written(amount: number): string {
	const sign = amount < 0 ? '-' : '';
	const whole = Math.trunc(Math.abs(amount) / 1000);
	const fraction = String(Math.abs(amount) % 1000)
		.padStart(3, '0')
		.replace(/0$/, '');
	return `${sign}${whole}.${fraction}`;
}

/** The amount a test gives: what the Give page's button says, and the same in thousandths. */
export interface Gift {
	/** The button's whole name: "Give 1.00 USD-TDN". */
	button: string;
	thousandths: number;
}

/**
 * The smallest amount on sale, from the names of the Give page's amount buttons. A reason, in
 * words, when there is none a test may give: no amount, a name that cannot be read, or a
 * smallest amount above the most a test may give.
 */
export function smallestGift(buttons: readonly string[]): Gift | { problem: string } {
	const gifts: Gift[] = [];
	for (const name of buttons.map((button) => button.replace(/\s+/g, ' ').trim())) {
		const amount = /^Give ([\d.,]+) USD-TDN$/.exec(name)?.[1];
		const value = amount === undefined ? null : thousandths(amount);
		if (value === null || value <= 0) {
			return { problem: `the Give page has an amount button this test cannot read: "${name}".` };
		}
		gifts.push({ button: name, thousandths: value });
	}
	const [smallest] = gifts.sort((a, b) => a.thousandths - b.thousandths);
	if (!smallest) return { problem: 'the Give page offers no amount.' };
	if (smallest.thousandths > MOST_THOUSANDTHS) {
		return {
			problem:
				`the smallest amount on sale is ${written(smallest.thousandths)}, more than the ` +
				`${written(MOST_THOUSANDTHS)} a test may give.`
		};
	}
	return smallest;
}

/** What a campaign's Funding block says: the total, in thousandths, and how many gifts make it. */
export interface Funding {
	raised: number;
	contributions: number;
}

/**
 * Reads the Funding block's own words ("1.00 USD-TDN raised … 1 contribution …"). The campaign
 * page draws no Funding block while no donation is recorded, so `null` (no block) is nothing
 * raised, from no contributions. Words it cannot read are not a zero: they throw.
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

/**
 * What happened to the campaign's total between two reads: nothing; exactly this one donation
 * (one more contribution, and its amount more); or something else, which is never passed off as
 * either.
 */
export function fundingMove(
	before: Funding,
	after: Funding,
	amount: number
): 'unchanged' | 'recorded' | 'other' {
	const raised = after.raised - before.raised;
	const contributions = after.contributions - before.contributions;
	if (raised === 0 && contributions === 0) return 'unchanged';
	return raised === amount && contributions === 1 ? 'recorded' : 'other';
}

const shownFunding = (funding: Funding) =>
	`${written(funding.raised)} raised (${funding.contributions})`;

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

/**
 * Takes out every number written with three decimals, which is how Qatom's checkout writes a
 * wallet's balance and a price. A test person's balance is not for a log.
 */
export function withoutBalances(text: string): string {
	return text.replace(/[$]?\d[\d,]*\.\d{3}\b/g, '(an amount)');
}

const quiet = (text: string) => withoutBalances(withoutAddresses(text));

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
 * read: only its host is named. No field's value is read, and no balance or price is kept.
 */
export function describeCheckoutScreen(seen: SeenPage, fields: readonly SeenField[]): string {
	const page = describeSeenPage({
		...seen,
		path: '',
		step: null,
		title: quiet(seen.title),
		headings: seen.headings.map(quiet),
		buttons: seen.buttons.map((button) => ({ ...button, text: quiet(button.text) })),
		alerts: seen.alerts.map(quiet),
		opening: quiet(seen.opening)
	});
	const asked = fields.map((field) => {
		const parts = [
			field.kind,
			field.id ? `#${tidy(field.id)}` : null,
			field.name ? `name "${tidy(field.name)}"` : null,
			field.autocomplete ? `autocomplete "${tidy(field.autocomplete)}"` : null,
			field.label ? `labelled "${tidy(quiet(field.label))}"` : null
		];
		return parts.filter((part) => part !== null).join(' ');
	});
	return `${page}\nFields: ${asked.length > 0 ? asked.join(' | ') : 'none'}.`;
}

/**
 * Which of the checkout's "Payment method" options is the wallet to pay from. Qatom lists
 * "Credit card" and then one option per wallet the person can pay from, each with its balance.
 * Exactly one wallet is expected. With none, or several, nothing is chosen: the reason names the
 * options without their balances. Answers the option's place in the list.
 */
export function walletOption(options: readonly string[]): { index: number } | { problem: string } {
	const names = options.map((option) => tidy(quiet(option)));
	const wallets = options.flatMap((option, index) => (/credit card/i.test(option) ? [] : [index]));
	const [only] = wallets;
	if (wallets.length === 1 && only !== undefined) return { index: only };
	const listed = names.map((name) => `"${name}"`).join(', ') || 'none';
	return {
		problem:
			wallets.length === 0
				? `Qatom’s checkout offers no wallet to pay from. Its payment methods were: ${listed}.`
				: `Qatom’s checkout offers ${wallets.length} wallets, and this test will not choose ` +
					`between them. Its payment methods were: ${listed}.`
	};
}

/**
 * True only for the one button a test may press to pay: its name starts with "Pay", ends with
 * "from wallet", and carries this amount as Qatom's checkout writes a price (three decimals,
 * "1.000"). A button named just "Pay <price>" pays by CARD: never that one.
 */
export function paysFromWallet(name: string, amount: number): boolean {
	const text = name.replace(/\s+/g, ' ').trim();
	const price = `${Math.trunc(amount / 1000)}.${String(amount % 1000).padStart(3, '0')}`;
	const prices: string[] = text.match(/\d[\d,]*\.\d+/g) ?? [];
	return /^Pay .* from wallet$/.test(text) && prices.length === 1 && prices[0] === price;
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
export function topUpNeeded(amount: number): string {
	return (
		'TOP UP NEEDED: NOTHING WAS PAID. Qatom’s checkout says the wallet does not hold enough for ' +
		'this purchase, and this test never uses a card. Add funds to the wallet the test ' +
		`contractor pays from on Qatom’s checkout: their primary wallet (a donation costs ` +
		`${written(amount)}, and nothing sends it back by itself).`
	);
}

/** After the one press. */
export const ENDINGS = {
	recorded: (amount: number, before: Funding, after: Funding) =>
		`THE DONATION WAS PAID AND RECORDED: ${written(amount)} USD-TDN left the test contractor’s ` +
		`wallet, and the campaign’s Funding block went from ${shownFunding(before)} to ` +
		`${shownFunding(after)}. Nothing sends it back by itself: the owner returns test money by hand.`,
	recordedOddly: (amount: number, before: Funding, after: Funding) =>
		'THE DONATION WAS PAID, AND THE CAMPAIGN’S TOTAL MOVED BY THE WRONG AMOUNT. One donation of ' +
		`${written(amount)} should add ${written(amount)} and one contribution. The Funding block ` +
		`went from ${shownFunding(before)} to ${shownFunding(after)}. Either Tejido counted it more ` +
		`than once, or someone else gave to the test campaign in the same minutes. ${LOOK_FIRST}`,
	notRecorded: (amount: number) =>
		`THE DONATION WAS PAID, BUT TEJIDO DID NOT RECORD IT within ${RECORD_WAIT_WORDS}. Qatom’s ` +
		'page says "Payment confirmed", and the campaign’s Funding block did not change. ' +
		`${written(amount)} USD-TDN left the test contractor’s wallet. Either Qatom has not called ` +
		`Tejido yet, or Tejido refused or lost the call. Do not pay again to find out. ${LOOK_FIRST}`,
	mayHaveBeenPaid: (shown: string) =>
		'THE DONATION MAY HAVE BEEN PAID. The pay button was pressed once. Qatom’s page did not say ' +
		`"Payment confirmed", and the campaign’s Funding block did not change within ` +
		`${RECORD_WAIT_WORDS}. ${LOOK_FIRST}\nWhat Qatom’s page showed after the press:\n${shown}`,
	notKnown: (amount: number, why: string) =>
		'IT IS NOT KNOWN WHETHER THE DONATION WAS PAID. The pay button was pressed once, and then ' +
		`${why} ${written(amount)} USD-TDN may have left the test contractor’s wallet. ${LOOK_FIRST}`
};
