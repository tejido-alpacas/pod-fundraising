/**
 * Paying one real donation on Qatom's checkout page, and finding out what happened.
 * THIS MOVES REAL MONEY. Only specs/paid-donation.spec.ts calls it, on a paid run, and only when
 * `E2E_PAID_DONATION` is exactly `true` (CLAUDE.md, "Never move money to test something").
 * WHEN THIS WAS WRITTEN NO RUN HAD REACHED THIS CODE.
 *
 * The donor here is the test CONTRACTOR, with nobody signed in on Tejido, paying from their own
 * PRIMARY wallet, which is the one Qatom's checkout offers. NOTHING SENDS THE DONATION BACK BY
 * ITSELF: the owner returns test money by hand, and the donation stays in the test campaign's
 * total until the cleanup removes the campaign.
 *
 * QATOM'S CHECKOUT PAGE, as written here, is FROM QATOM'S SOURCE (read by the coordinator, 15
 * November 2026), NEVER YET DRIVEN BY THIS SUITE. One page at one address, no reload (a reload
 * signs the shopper out):
 *
 *   1. "Complete your purchase": the email field #checkout-entry-email and the button
 *      #checkoutEntryStep-continue. Or a load error: "Already paid", "Link expired", "Payment in
 *      progress", "Something went wrong".
 *   2. "Verify & pay": one field labelled "Verification code", which submits itself at six
 *      digits. A status "Verified" is what says the code was accepted.
 *   3. "Preparing your wallet…", then a "Payment method" dropdown. THE PAGE STARTS ON "Credit
 *      card": the one wallet option is chosen first.
 *   4. The pay button, named "Pay <price> from wallet". A button named only "Pay <price>" pays
 *      BY CARD and is never pressed. A wallet that is short shows "This wallet does not hold
 *      enough for this purchase." and that is the "TOP UP NEEDED" ending.
 *   5. "Payment confirmed". The page does not send the browser back to Tejido.
 *
 * The rules, whatever the page does: every step waits a bounded time for exactly what it
 * expects, and anything else ends the test with "NOTHING WAS PAID, as far as the page shows"
 * and no further press. Only four things are ever pressed there: Continue, the "Payment method"
 * dropdown, the one wallet option, and the pay-from-wallet button, ONCE. A card is never typed.
 *
 * The checkout's address can be paid by whoever holds it. It is never printed, written or
 * photographed, no Playwright wait is given it, and every error from that page has its
 * addresses taken out before it is reported. No balance, and no transaction id, is written.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { E2eConfig } from './config.ts';
import {
	describeCheckoutScreen,
	ENDINGS,
	fundingFromWords,
	fundingMove,
	nothingPaid,
	paysFromWallet,
	quietly,
	RECORD_WAIT_MS,
	smallestGift,
	TEST_ORGANISER,
	topUpNeeded,
	walletOption,
	withoutAddresses,
	withoutBalances,
	type Funding,
	type Gift,
	type SeenField
} from './donation-outcome.ts';
import { test, type Waypoint } from './harness.ts';
import { waitForSignInCode, type InboxQueue } from './inbox.ts';
import { assertQatomCheckoutPage, onOrigin, QATOM_CHECKOUT_HOST } from './safety.ts';
import { seenOn } from './seen-page.ts';
import { tidy } from './stuck-page.ts';

/** The checkout's own words and fields. From Qatom's source; never yet driven by this suite. */
const CHECKOUT = {
	email: (page: Page) => page.locator('#checkout-entry-email'),
	continue: (page: Page) => page.locator('#checkoutEntryStep-continue'),
	code: (page: Page) => page.getByLabel('Verification code'),
	verified: (page: Page) => page.getByRole('status').filter({ hasText: 'Verified' }),
	preparing: (page: Page) => page.getByText('Preparing your wallet…'),
	method: (page: Page) => page.getByRole('button', { name: 'Payment method', exact: true }),
	options: (page: Page) => page.getByRole('option'),
	short: (page: Page) => page.getByText('This wallet does not hold enough for this purchase.'),
	/** The ONLY button that pays. Its name ends in "from wallet"; "Pay <price>" alone is the card. */
	pay: (page: Page) => page.getByRole('button', { name: /^Pay .* from wallet$/ }),
	paid: (page: Page) => page.getByRole('heading', { name: 'Payment confirmed', exact: true }),
	alert: (page: Page) => page.getByRole('alert'),
	loadErrors: ['Already paid', 'Link expired', 'Payment in progress', 'Something went wrong']
};

const QUICK = { timeout: 5_000 };
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function onCheckout(url: string): boolean {
	return (
		onOrigin(url, `https://${QATOM_CHECKOUT_HOST}`) &&
		(URL.parse(url)?.pathname.startsWith('/checkout/') ?? false)
	);
}

/** The host a page is on, and nothing else of its address. */
function hostOf(url: string): string {
	return URL.parse(url)?.host || 'no page';
}

/**
 * Waits up to `ms` for `look` to answer something, and answers null if it never does. A page
 * between two screens can make a look fail: that is looked at again, never reported.
 */
async function firstOf<T>(ms: number, look: () => Promise<T | null>): Promise<T | null> {
	const deadline = Date.now() + ms;
	for (;;) {
		const answer = await look().catch(() => null);
		if (answer !== null) return answer;
		if (Date.now() >= deadline) return null;
		await pause(500);
	}
}

const shows = (locator: Locator) => locator.first().isVisible();

/**
 * The run's own campaign, opened by its address: it must exist and name the suite as its
 * organiser. Fails with "NOTHING WAS PAID" otherwise. Nothing is pressed.
 */
export async function openTestCampaign(
	page: Page,
	siteUrl: string,
	campaignId: string
): Promise<void> {
	const response = await page.goto(`${siteUrl}/campaigns/${campaignId}`);
	if (response?.status() !== 200) {
		throw new Error(
			nothingPaid(`the campaign’s page answered ${response?.status() ?? 'nothing'}.`)
		);
	}
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	// Never a real campaign: test money must not show in a real fundraiser's public total.
	if (!(await shows(page.getByText(`Organised by ${TEST_ORGANISER}.`)))) {
		throw new Error(
			nothingPaid(
				`the campaign "${campaignId}" does not name "${TEST_ORGANISER}" as its organiser, so ` +
					'it is not the suite’s own campaign and this test will not give to it.'
			)
		);
	}
}

/**
 * As the campaign's creator, signed in on the Campaign Site: publishes the run's campaign if it
 * is still a draft, with one press of "Publish campaign", so that it takes donations. Moves no
 * money. Stops with a plain reason if the button is not offered.
 */
export async function publishIfDraft(
	page: Page,
	siteUrl: string,
	campaignId: string
): Promise<'published' | 'already'> {
	await openTestCampaign(page, siteUrl, campaignId);
	const give = page.getByRole('link', { name: 'Give to this campaign' });
	const draft = page.getByRole('heading', { name: 'This campaign is a draft' });
	if (!(await shows(draft))) {
		if (await shows(give)) return 'already';
		throw new Error(
			nothingPaid(
				'the run’s campaign is not a draft and does not offer "Give to this campaign": it is ' +
					'not raising money, and this test cannot make it.'
			)
		);
	}
	const publish = page.getByRole('button', { name: 'Publish campaign', exact: true });
	if (!(await shows(publish))) {
		const why = (await shows(page.getByRole('link', { name: 'Sign in to publish' })))
			? 'nobody is signed in on the Campaign Site in this browser. The suite’s visitor signs ' +
				'in there first (specs/site-sign-in.spec.ts); this test must run after it.'
			: (await shows(page.getByRole('link', { name: 'Sign in with another email' })))
				? 'the person signed in is not the campaign’s organiser. The run’s campaign must be ' +
					'created with the suite’s visitor as its organiser (lib/run-campaign.ts).'
				: 'the page does not offer "Publish campaign".';
		throw new Error(
			nothingPaid(`the run’s campaign is a draft and could not be published: ${why}`)
		);
	}
	await publish.click();
	await expect(
		give,
		'NOTHING WAS PAID: "Publish campaign" was pressed and the campaign does not offer "Give to ' +
			'this campaign".'
	).toBeVisible({ timeout: 30_000 });
	return 'published';
}

/** The campaign's Funding block, read from its public page as a visitor reads it. */
export async function readFunding(
	page: Page,
	siteUrl: string,
	campaignId: string
): Promise<Funding> {
	await page.goto(`${siteUrl}/campaigns/${campaignId}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const stands = page.getByLabel('Where this campaign stands');
	await expect(stands).toBeVisible();
	// No Funding block is drawn while no donation is recorded: that is nothing raised.
	const block = stands.locator('.tj-funding');
	return fundingFromWords((await block.count()) > 0 ? await block.first().innerText() : null);
}

/** The campaign's Give page, and the smallest amount on sale there. Nothing is pressed. */
export async function smallestGiftOnSale(
	page: Page,
	siteUrl: string,
	campaignId: string
): Promise<Gift> {
	await page.goto(`${siteUrl}/give/${campaignId}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Give to .+/);
	const amounts = page.getByRole('main').getByRole('button', { name: /^Give [\d.,]+ USD-TDN$/ });
	const gift = smallestGift(await amounts.allInnerTexts());
	if ('problem' in gift) throw new Error(nothingPaid(`${gift.problem} No checkout was made.`));
	return gift;
}

/**
 * Presses the amount on the Give page, once, and answers the page Qatom's checkout opened in: a
 * new window, or this same tab, whichever the Give page does. Making a checkout charges
 * nothing: nothing is paid until the pay button.
 */
export async function startCheckout(page: Page, siteUrl: string, gift: Gift): Promise<Page> {
	const context = page.context();
	const known = new Set(context.pages());
	await page
		.getByRole('main')
		.getByRole('button', { name: gift.button, exact: true })
		.click({ noWaitAfter: true });

	// Where each page is, is read; the checkout's address is never waited on or written.
	let said: string | null = null;
	const checkout = await firstOf(45_000, async () => {
		const opened = context.pages().find((other) => !known.has(other));
		if (opened && onCheckout(opened.url())) return opened;
		if (onCheckout(page.url())) return page;
		// A refusal is the Give page itself with a notice, drawn in the new window when one opened.
		const refused = opened ?? page;
		const problem = refused.getByRole('alert');
		if (onOrigin(refused.url(), siteUrl) && (await problem.isVisible())) {
			said = (await problem.innerText()).trim();
			return refused;
		}
		return null;
	});
	if (checkout !== null && said === null) return checkout;

	const opened = context.pages().find((other) => !known.has(other));
	const where = hostOf((opened ?? page).url());
	await opened?.close().catch(() => undefined);
	if (!onOrigin(page.url(), siteUrl)) await page.goto('about:blank').catch(() => undefined);
	throw new Error(
		nothingPaid(
			said !== null
				? `the Give page did not start a checkout. It said: "${tidy(said, 200)}".`
				: `pressing the amount did not arrive on one of Qatom’s checkout pages on ` +
						`${QATOM_CHECKOUT_HOST} within 45 seconds. The browser was on ${where}. Nothing ` +
						'was typed or pressed there.'
		)
	);
}

/** The fields a screen asks for, as a person could tell them apart. No value is read. */
async function fieldsOn(page: Page): Promise<SeenField[]> {
	const fields: SeenField[] = [];
	const quick = { timeout: 2_000 };
	try {
		for (const field of await page.locator('input, select, textarea, iframe').all()) {
			if (fields.length >= 12) break;
			if (!(await field.isVisible())) continue;
			const kind = await field.evaluate((element) => element.tagName.toLowerCase(), quick);
			const type = await field.getAttribute('type', quick);
			if (type === 'hidden') continue;
			fields.push({
				kind: kind === 'iframe' ? 'an embedded frame' : type ? `${kind} ${type}` : kind,
				id: kind === 'iframe' ? null : await field.getAttribute('id', quick),
				name: kind === 'iframe' ? null : await field.getAttribute('name', quick),
				autocomplete: await field.getAttribute('autocomplete', quick),
				label:
					(await field.getAttribute('aria-label', quick)) ??
					(await field.getAttribute('placeholder', quick)) ??
					(await field.getAttribute('title', quick))
			});
		}
	} catch {
		// The page changed while it was read. What was read so far is still worth saying.
	}
	return fields;
}

/** What the checkout shows now, for the log: no address, no value, no balance. */
async function screenOf(page: Page): Promise<string> {
	if (page.isClosed()) return 'The page was gone.';
	return describeCheckoutScreen(await seenOn(page), await fieldsOn(page));
}

/**
 * On Qatom's checkout page (`checkout`, from `startCheckout`): signs the test contractor in with
 * an emailed code, chooses their wallet, pays the donation with ONE press, and waits for the
 * campaign's Funding block to show it.
 *
 * Returns only when the donation was paid and recorded. Every other way out throws, or skips,
 * saying what is known about the money. The checkout page is always closed or left before
 * returning or throwing, so nothing that reports a failure afterwards can read its address.
 */
export async function payDonation(
	checkout: Page,
	cfg: E2eConfig,
	gift: Gift,
	queue: InboxQueue,
	waypoint: Waypoint,
	testInfo: TestInfo
): Promise<void> {
	// The campaign's page is read in a tab of its own, so the checkout page is never reloaded.
	let site: Page | null = null;
	try {
		site = await checkout.context().newPage();
		return await throughCheckout(checkout, site, cfg, gift, queue, waypoint, testInfo);
	} finally {
		await checkout.goto('about:blank').catch(() => undefined);
		await site?.close().catch(() => undefined);
	}
}

async function throughCheckout(
	page: Page,
	site: Page,
	cfg: E2eConfig,
	gift: Gift,
	queue: InboxQueue,
	waypoint: Waypoint,
	testInfo: TestInfo
): Promise<void> {
	const payer = cfg.contractor.email;
	let step = 0;
	/** What the run met, step by step: the first real runs are how this page is confirmed. */
	const met = async (what: string): Promise<void> => {
		step += 1;
		const shown = await screenOf(page);
		console.log(`Qatom’s checkout, step ${step} (${what}):\n${shown}`);
		testInfo.annotations.push({ type: `checkout step ${step}: ${what}`, description: shown });
	};
	/** Ends the test before the press: says why, and what the page showed. Presses nothing. */
	const stop = async (why: string): Promise<never> => {
		throw new Error(nothingPaid(why, await screenOf(page)));
	};
	/** The words of the alert the page shows, with no address or balance, or null. */
	const alertWords = async (): Promise<string | null> => {
		if (!(await shows(CHECKOUT.alert(page)))) return null;
		const words = await CHECKOUT.alert(page).first().innerText(QUICK);
		return tidy(withoutBalances(withoutAddresses(words)), 240) || null;
	};
	/** A press or a typing that failed, in this test's own words: Playwright's could carry an address. */
	const act = async (what: string, action: () => Promise<unknown>): Promise<void> => {
		const failed = await action().then(
			() => null,
			(error: unknown) => quietly(error)
		);
		if (failed !== null) await stop(`${what} did not go through: ${failed}.`);
	};

	// 1. The entry screen, or one of the page's own load errors.
	const entry = await firstOf(45_000, async () => {
		if (!onCheckout(page.url())) return 'left';
		if (await shows(CHECKOUT.email(page))) return 'entry';
		for (const name of CHECKOUT.loadErrors) {
			if (await shows(page.getByRole('heading', { name, exact: true }))) return name;
		}
		return null;
	});
	await met(entry ?? 'a screen this test does not know');
	if (entry === 'left') {
		throw new Error(
			nothingPaid(`the browser left Qatom’s checkout page for ${hostOf(page.url())}.`)
		);
	}
	if (entry !== 'entry') {
		await stop(
			entry === null
				? 'Qatom’s checkout page did not show its email field within 45 seconds.'
				: `Qatom’s checkout page says "${entry}".`
		);
	}

	// 2. The payer's email, and Continue: that asks Qatom for ONE emailed code.
	// An email address or a code is typed on Qatom's checkout page and nowhere else.
	assertQatomCheckoutPage(page.url());
	await act('typing the email address', () => CHECKOUT.email(page).fill(payer, QUICK));
	if (
		(await firstOf(10_000, async () => (await CHECKOUT.continue(page).isEnabled()) || null)) ===
		null
	) {
		await stop('the "Continue" button cannot be pressed.');
	}
	// A little slack for two clocks that disagree: no older email can be this sign-in's code.
	const askedAt = Date.now() - 30_000;
	await act('pressing "Continue"', () =>
		CHECKOUT.continue(page).click({ ...QUICK, noWaitAfter: true })
	);

	// 3. The code. One code, asked for once. Nothing here asks for another.
	const asked = await firstOf(45_000, async () => {
		if (await shows(CHECKOUT.code(page))) return 'code';
		return (await alertWords()) === null ? null : 'alert';
	});
	await met(asked === 'code' ? 'the code is asked for' : 'no code field');
	if (asked !== 'code') {
		await stop(
			asked === 'alert'
				? `Qatom’s checkout page did not ask for a code. It said: "${(await alertWords()) ?? ''}".`
				: 'Qatom’s checkout page did not ask for the emailed code within 45 seconds.'
		);
	}
	const digits = await waitForSignInCode(queue, {
		recipient: payer,
		notBeforeMs: askedAt,
		timeoutMs: 120_000
	}).catch((error: unknown) => ({ failed: quietly(error) }));
	if (typeof digits !== 'string') {
		return await stop(`the emailed code did not arrive: ${digits.failed}`);
	}
	assertQatomCheckoutPage(page.url());
	await act('typing the code', () => CHECKOUT.code(page).fill(digits, QUICK));

	// 4. "Verified" is what says the code was accepted; the heading alone does not.
	const verified = await firstOf(60_000, async () => {
		if (await shows(CHECKOUT.verified(page))) return 'verified';
		return (await alertWords()) === null ? null : 'alert';
	});
	if (verified !== 'verified') {
		await met('not verified');
		await stop(
			verified === 'alert'
				? `Qatom’s checkout page did not accept the code. It said: "${(await alertWords()) ?? ''}".`
				: 'Qatom’s checkout page did not say "Verified" within 60 seconds of the code.'
		);
	}

	// 5. The wallets load, then the "Payment method" dropdown. The page starts on "Credit card".
	const loaded = await firstOf(120_000, async () =>
		(await shows(CHECKOUT.method(page))) && !(await shows(CHECKOUT.preparing(page))) ? true : null
	);
	await met(loaded ? 'verified, payment methods shown' : 'verified, no payment methods');
	if (loaded === null) {
		await stop('Qatom’s checkout page did not offer its payment methods within 120 seconds.');
	}
	await act('opening "Payment method"', () => CHECKOUT.method(page).click(QUICK));
	const options = await firstOf(10_000, async () => {
		const texts = await CHECKOUT.options(page).allInnerTexts();
		return texts.length > 0 ? texts : null;
	});
	if (options === null) return await stop('the "Payment method" dropdown listed nothing.');
	const wallet = walletOption(options);
	if ('problem' in wallet) return await stop(wallet.problem);
	await act('choosing the wallet', () => CHECKOUT.options(page).nth(wallet.index).click(QUICK));

	// 6. With the wallet chosen: the pay-from-wallet button, or a wallet that is short.
	const ready = await firstOf(30_000, async () => {
		if (await shows(CHECKOUT.short(page))) return 'short';
		const pay = CHECKOUT.pay(page);
		return (await pay.count()) === 1 && (await pay.isVisible()) && (await pay.isEnabled())
			? 'ready'
			: null;
	});
	await met(ready ?? 'no pay-from-wallet button');
	if (ready === 'short') {
		// A job for a person, not a fault: a yellow notice, and the test is skipped, not failed.
		const notice = topUpNeeded(gift.thousandths);
		console.log(`::warning title=End-to-end: top up needed::${notice}`);
		test.skip(true, notice);
	}
	if (ready !== 'ready') {
		await stop(
			'Qatom’s checkout page did not offer one "Pay … from wallet" button that can be ' +
				'pressed within 30 seconds of the wallet being chosen.'
		);
	}
	const pay = CHECKOUT.pay(page);
	const name = await pay.innerText(QUICK).catch(() => '');
	if (!paysFromWallet(name, gift.thousandths)) {
		await stop(
			'the pay button does not name this donation’s amount and "from wallet", so it was not ' +
				'pressed.'
		);
	}

	// 7. Everything else is checked before the one press.
	const before: Funding | string = await readFunding(site, cfg.siteUrl, cfg.campaignId).catch(
		(error: unknown) => quietly(error)
	);
	if (typeof before === 'string') {
		return await stop(
			`the campaign’s Funding block could not be read just before paying: ${before}.`
		);
	}
	expect(testInfo.retry, 'A donation must never be paid on a retry.').toBe(0);

	// 8. THE ONE PRESS. From here on money may have moved, and every way out says what is known.
	// The button is never pressed again, whatever the page shows or offers next.
	const amount = gift.thousandths;
	const pressFailed = await pay.click({ timeout: 15_000, noWaitAfter: true }).then(
		() => null,
		// A press that reports a failure may still have landed.
		(error: unknown) => quietly(error)
	);

	// 9. Has Tejido recorded it? Qatom calls Tejido itself after a payment; the suite never does.
	const deadline = Date.now() + RECORD_WAIT_MS;
	let after = before;
	let move: ReturnType<typeof fundingMove> = 'unchanged';
	let reads = 0;
	let saidPaid = false;
	let alerted: string | null = null;
	for (;;) {
		saidPaid ||= await shows(CHECKOUT.paid(page)).catch(() => false);
		// Never read once the page says paid: it then shows a transaction id.
		if (!saidPaid) alerted ??= await alertWords().catch(() => null);
		try {
			after = await readFunding(site, cfg.siteUrl, cfg.campaignId);
			move = fundingMove(before, after, amount);
			reads += 1;
		} catch {
			// One read failed. The next is tried; none succeeding is "not known" below.
		}
		if (move !== 'unchanged' || Date.now() >= deadline) break;
		await pause(5_000);
	}

	if (move === 'recorded') {
		await waypoint(site, 'campaign-with-the-donation').catch(() => undefined);
		const ending = ENDINGS.recorded(amount, before, after);
		console.log(ending);
		testInfo.annotations.push({ type: 'paid', description: ending });
		return;
	}
	if (move === 'other') {
		await waypoint(site, 'campaign-with-the-donation').catch(() => undefined);
		throw new Error(ENDINGS.recordedOddly(amount, before, after));
	}

	// The total did not change in the time allowed. What Qatom's page shows is all there is.
	if (saidPaid) throw new Error(ENDINGS.notRecorded(amount));
	if (reads === 0) {
		throw new Error(
			ENDINGS.notKnown(
				amount,
				'the campaign’s page could not be read even once in the time allowed.'
			)
		);
	}
	if (page.isClosed()) throw new Error(ENDINGS.notKnown(amount, 'Qatom’s page was gone.'));
	const shown =
		(alerted === null ? '' : `It showed this alert: "${alerted}".\n`) + (await screenOf(page));
	if (pressFailed !== null) {
		throw new Error(
			ENDINGS.notKnown(
				amount,
				`the press itself reported a failure (${pressFailed}), so it may or may not have ` +
					`landed.\nWhat Qatom’s page showed afterwards:\n${shown}\n`
			)
		);
	}
	throw new Error(ENDINGS.mayHaveBeenPaid(shown));
}
